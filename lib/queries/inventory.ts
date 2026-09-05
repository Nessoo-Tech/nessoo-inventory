import 'server-only'
import { db } from '../db'
import type { PoolClient } from 'pg'

// Inventory management, written directly against RDS through the
// `nessoo_admin_app` role rather than by calling homey-ux's broker API.
//
// This is a deliberate deviation from the original plan, which had these
// routes living in homey-ux behind a withAdminOrg wrapper. Going direct is
// better here because:
//   * homey-ux's withBrokerOrg derives org_id from the caller's own members
//     row and its stated invariant is that org_id never comes from the client.
//     A cross-org admin tool needs the opposite, and bolting that onto the
//     broker path is exactly how a broker route later inherits client-supplied
//     org trust by copy-paste.
//   * The restricted DB role is ALREADY the write boundary — it can only touch
//     properties and units, and cannot DELETE either. Routing the same writes
//     through a second HTTP hop would not add a check, it would just move where
//     the same SQL runs while adding cross-origin auth to get wrong.
// The cost is that createUnit/updateUnit's ~40 lines of SQL are not reused.
// That is a real cost, accepted knowingly.

export type UnitStatus = 'active' | 'inactive' | 'leased' | 'archived'
const UNIT_STATUSES: UnitStatus[] = ['active', 'inactive', 'leased', 'archived']

export interface OrgRow {
  id: string
  name: string
  slug: string
  isModelB: boolean
  properties: number
  units: number
}

export interface UnitRow {
  id: string
  orgId: string
  orgName: string
  propertyId: string
  propertyName: string
  address: string
  city: string | null
  name: string
  bedrooms: number | null
  bathrooms: string | null
  rentCents: number | null
  status: UnitStatus
  availableFrom: string | null
  neighborhood: string | null
}

export async function listOrganizations(): Promise<OrgRow[]> {
  const { rows } = await db.query(`
    SELECT o.id, o.name, o.slug, o.is_model_b,
           COUNT(DISTINCT p.id) FILTER (WHERE p.deleted_at IS NULL) AS properties,
           COUNT(DISTINCT u.id) FILTER (WHERE u.deleted_at IS NULL) AS units
    FROM organizations o
    LEFT JOIN properties p ON p.org_id = o.id
    LEFT JOIN units u      ON u.org_id = o.id
    WHERE o.deleted_at IS NULL
    GROUP BY o.id, o.name, o.slug, o.is_model_b
    ORDER BY o.name`)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    isModelB: r.is_model_b,
    properties: Number(r.properties),
    units: Number(r.units),
  }))
}

export async function listUnits(orgId?: string): Promise<UnitRow[]> {
  const params: unknown[] = []
  let where = 'u.deleted_at IS NULL AND p.deleted_at IS NULL'
  if (orgId) {
    params.push(orgId)
    where += ` AND u.org_id = $${params.length}`
  }

  const { rows } = await db.query(`
    SELECT u.id, u.org_id, o.name AS org_name, u.property_id, p.name AS property_name,
           p.address, p.city, u.name, u.bedrooms, u.bathrooms, u.rent_cents, u.status,
           u.available_from, u.other_criteria->>'neighborhood' AS neighborhood
    FROM units u
    JOIN properties p    ON p.id = u.property_id
    JOIN organizations o ON o.id = u.org_id
    WHERE ${where}
    ORDER BY o.name, p.address, u.name
    LIMIT 2000`, params)

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    orgName: r.org_name,
    propertyId: r.property_id,
    propertyName: r.property_name,
    address: r.address,
    city: r.city,
    name: r.name,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    rentCents: r.rent_cents,
    status: r.status,
    availableFrom: r.available_from ? new Date(r.available_from).toISOString().slice(0, 10) : null,
    neighborhood: r.neighborhood,
  }))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface Actor {
  id: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * Audit row written INSIDE the caller's transaction, so a write that cannot be
 * recorded does not happen at all.
 *
 * This is intentionally stricter than homey-ux's recordAuditEvent(), which
 * swallows its own errors by design so an audit failure never breaks the action
 * it was describing. That tradeoff is right for logging a document view. It is
 * wrong for a cross-org admin mutating another company's inventory, where an
 * unrecorded write is the exact thing the audit trail exists to prevent.
 */
async function audit(
  client: PoolClient,
  actor: Actor,
  action: 'create' | 'update' | 'delete',
  objectType: string,
  objectId: string,
  orgId: string | null,
  metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_events
       (actor_id, org_id, action, object_type, object_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3::audit_action, $4, $5, $6, $7, $8::jsonb)`,
    [
      actor.id,
      orgId,
      action,
      objectType,
      objectId,
      actor.ip ?? null,
      actor.userAgent ? actor.userAgent.slice(0, 400) : null,
      JSON.stringify({ ...metadata, surface: 'admin.nessoo.com' }),
    ],
  )
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export class ValidationError extends Error {}

function requireText(value: unknown, field: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
  const v = value.trim()
  if (v.length > max) throw new ValidationError(`${field} is too long`)
  return v
}

/**
 * Only a real number or a numeric string counts. This matters more than it
 * looks: JSON.parse can hand us `[]`, `false` or `''`, and bare Number() turns
 * every one of those into 0 — which would silently publish a live listing at
 * $0/month rather than rejecting the request.
 */
function toNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${field} must be a number`)
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  throw new ValidationError(`${field} must be a number`)
}

function isUnset(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  if (isUnset(value)) return null
  const n = toNumber(value, field)
  if (!Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`)
  if (n < min || n > max) throw new ValidationError(`${field} is out of range`)
  return n
}

/** Dollars in, cents out. Rejects anything that isn't genuinely numeric. */
function optionalMoneyCents(value: unknown, field: string): number | null {
  if (isUnset(value)) return null
  const dollars = toNumber(value, field)
  if (dollars < 0) throw new ValidationError(`${field} cannot be negative`)
  if (dollars > 100_000) throw new ValidationError(`${field} is out of range`)
  return Math.round(dollars * 100)
}

function optionalDecimal(value: unknown, field: string, min: number, max: number): number | null {
  if (isUnset(value)) return null
  const n = toNumber(value, field)
  if (n < min || n > max) throw new ValidationError(`${field} is out of range`)
  return n
}

export interface PropertyInput {
  orgId: string
  name: string
  address: string
  city: string
  state: string
  // Required, not optional: properties.zip is NOT NULL with no default, so a
  // missing zip is a 400 here rather than a 500 from Postgres.
  zip: string
}

export async function createProperty(actor: Actor, input: PropertyInput): Promise<string> {
  const orgId = requireText(input.orgId, 'organization', 100)
  const name = requireText(input.name, 'name')
  const address = requireText(input.address, 'address')
  const city = requireText(input.city, 'city', 120)
  const state = requireText(input.state, 'state', 2)
  const zip = requireText(input.zip, 'zip', 10)

  return inTransaction(async (client) => {
    const { rows: org } = await client.query(
      'SELECT 1 FROM organizations WHERE id = $1 AND deleted_at IS NULL', [orgId])
    if (!org.length) throw new ValidationError('organization not found')

    const { rows } = await client.query(
      `INSERT INTO properties (org_id, name, address, city, state, zip, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id`,
      [orgId, name, address, city, state, zip])

    const id = rows[0].id
    await audit(client, actor, 'create', 'property', id, orgId, { name, address, city, state, zip })
    return id
  })
}

export interface UnitInput {
  orgId: string
  propertyId: string
  name: string
  bedrooms?: number | null
  bathrooms?: number | null
  rentDollars?: number | null
  status?: UnitStatus
  neighborhood?: string | null
}

export async function createUnit(actor: Actor, input: UnitInput): Promise<string> {
  const orgId = requireText(input.orgId, 'organization', 100)
  const propertyId = requireText(input.propertyId, 'building', 100)
  const name = requireText(input.name, 'unit name', 60)
  const bedrooms = optionalInt(input.bedrooms, 'bedrooms', 0, 20)
  const bathrooms = optionalDecimal(input.bathrooms, 'bathrooms', 0, 20)
  const rentCents = optionalMoneyCents(input.rentDollars, 'rent')
  const status: UnitStatus = UNIT_STATUSES.includes(input.status as UnitStatus)
    ? (input.status as UnitStatus)
    : 'active'
  // Neighborhood is matched by EXACT string elsewhere in the platform against a
  // canonical gazetteer — a typo here does not fail loudly, it silently drops
  // the unit out of neighborhood searches. Shape is validated here; the
  // canonical list lives in homey-ux, so mis-spellings remain possible.
  const neighborhood = isUnset(input.neighborhood)
    ? null
    : requireText(input.neighborhood, 'neighborhood', 80)

  return inTransaction(async (client) => {
    // The property must belong to the org being written to — this is the check
    // that stops a malformed request grafting a unit onto another company.
    const { rows: prop } = await client.query(
      'SELECT 1 FROM properties WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
      [propertyId, orgId])
    if (!prop.length) throw new ValidationError('building not found for this organization')

    const other = neighborhood ? JSON.stringify({ neighborhood }) : null

    const { rows } = await client.query(
      `INSERT INTO units (org_id, property_id, name, bedrooms, bathrooms, rent_cents, status, other_criteria)
       VALUES ($1, $2, $3, $4, $5, $6, $7::unit_status, COALESCE($8::jsonb, '{}'::jsonb))
       RETURNING id`,
      [orgId, propertyId, name, bedrooms, bathrooms, rentCents, status, other])

    const id = rows[0].id
    // Record the values actually written, not the raw request — otherwise the
    // immutable log describes something different from the row it refers to.
    await audit(client, actor, 'create', 'unit', id, orgId, {
      propertyId, name, bedrooms, bathrooms, rentCents, status, neighborhood,
    })
    return id
  })
}

export async function updateUnit(
  actor: Actor,
  unitId: string,
  patch: Partial<Pick<UnitInput, 'name' | 'bedrooms' | 'rentDollars' | 'status' | 'neighborhood'>>
    & { availableFrom?: string | null },
): Promise<void> {
  const id = requireText(unitId, 'unit id', 100)

  const sets: string[] = []
  const params: unknown[] = []
  const applied: Record<string, unknown> = {}

  // Each branch records the value actually written, so the audit row always
  // matches the row it describes.
  if (patch.name !== undefined) {
    const v = requireText(patch.name, 'unit name', 60)
    params.push(v)
    sets.push(`name = $${params.length}`)
    applied.name = v
  }
  if (patch.bedrooms !== undefined) {
    const v = optionalInt(patch.bedrooms, 'bedrooms', 0, 20)
    params.push(v)
    sets.push(`bedrooms = $${params.length}`)
    applied.bedrooms = v
  }
  if (patch.rentDollars !== undefined) {
    const cents = optionalMoneyCents(patch.rentDollars, 'rent')
    params.push(cents)
    sets.push(`rent_cents = $${params.length}`)
    applied.rentCents = cents
  }
  if (patch.status !== undefined) {
    if (!UNIT_STATUSES.includes(patch.status)) throw new ValidationError('invalid status')
    params.push(patch.status)
    sets.push(`status = $${params.length}::unit_status`)
    applied.status = patch.status
  }

  if (patch.availableFrom !== undefined) {
    const v = isUnset(patch.availableFrom) ? null : requireText(patch.availableFrom, 'available from', 10)
    if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError('available from must be YYYY-MM-DD')
    params.push(v)
    sets.push(`available_from = $${params.length}::date`)
    applied.availableFrom = v
  }
  if (patch.neighborhood !== undefined) {
    // Merged into other_criteria rather than replacing it, so setting a
    // neighborhood cannot silently drop features or the migration provenance
    // stored alongside it.
    const v = isUnset(patch.neighborhood) ? null : requireText(patch.neighborhood, 'neighborhood', 80)
    if (v === null) {
      sets.push(`other_criteria = other_criteria - 'neighborhood'`)
    } else {
      params.push(JSON.stringify({ neighborhood: v }))
      sets.push(`other_criteria = COALESCE(other_criteria, '{}'::jsonb) || $${params.length}::jsonb`)
    }
    applied.neighborhood = v
  }

  if (!sets.length) throw new ValidationError('nothing to update')

  await inTransaction(async (client) => {
    params.push(id)
    const { rows } = await client.query(
      `UPDATE units SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING id, org_id`,
      params)
    if (!rows.length) throw new ValidationError('unit not found')
    await audit(client, actor, 'update', 'unit', rows[0].id, rows[0].org_id, applied)
  })
}

/**
 * Soft delete, matching the convention used everywhere in homey-ux — the role
 * has no DELETE grant at all, so this is the only removal path that exists.
 */
export async function archiveUnit(actor: Actor, unitId: string, reason: string): Promise<void> {
  const id = requireText(unitId, 'unit id', 100)
  const why = requireText(reason, 'reason', 500)

  await inTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE units SET deleted_at = NOW(), status = 'archived'::unit_status, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, org_id, name`,
      [id])
    if (!rows.length) throw new ValidationError('unit not found')
    await audit(client, actor, 'delete', 'unit', rows[0].id, rows[0].org_id, {
      name: rows[0].name,
      reason: why,
      softDelete: true,
    })
  })
}
