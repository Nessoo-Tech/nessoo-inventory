import 'server-only'
import { db } from '../db'

// Everything the five inventory tabs render, shaped to mirror the original
// dashboard's model: clients (organizations), listings (units joined to their
// building), renters (the migrated prospects) and their matches.

export interface ClientRow { id: string; name: string; unitCount: number; isModelB: boolean }

export interface ListingRow {
  id: string
  clientId: string
  clientName: string
  propertyId: string
  address: string
  city: string | null
  unit: string
  rentCents: number | null
  bedrooms: number | null
  bathrooms: string | null
  neighborhood: string | null
  incomeRequirement: string | null
  features: string[]
  securityDepositCents: number | null
  availableFrom: string | null
  status: string
  isPublished: boolean
  daysOnMarket: number | null
  createdAt: string
  updatedAt: string
}

export interface ProspectRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  budgetMinCents: number | null
  budgetMaxCents: number | null
  bedroomsNeeded: number | null
  neighborhoods: string[]
  moveInDate: string | null
  status: string
  notes: string | null
  createdAt: string
}

export interface InventoryData {
  clients: ClientRow[]
  listings: ListingRow[]
  prospects: ProspectRow[]
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function getInventoryData(): Promise<InventoryData> {
  const [clients, listings, prospects] = await Promise.all([
    db.query(`
      SELECT o.id, o.name, o.is_model_b,
             COUNT(u.id) FILTER (WHERE u.deleted_at IS NULL)::int AS units
      FROM organizations o
      LEFT JOIN units u ON u.org_id = o.id
      WHERE o.deleted_at IS NULL
      GROUP BY o.id, o.name, o.is_model_b
      ORDER BY o.name`),

    db.query(`
      SELECT u.id, u.org_id, o.name AS client_name, u.property_id, p.address, p.city,
             u.name AS unit, u.rent_cents, u.bedrooms, u.bathrooms, u.status,
             u.available_from, u.created_at, u.updated_at, u.other_criteria,
             -- The legacy schema stored days_on_market as a column that drifted.
             -- Deriving it means it can never be stale.
             EXTRACT(DAY FROM NOW() - u.created_at)::int AS days_on_market
      FROM units u
      JOIN properties p ON p.id = u.property_id
      JOIN organizations o ON o.id = u.org_id
      WHERE u.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY u.created_at DESC
      LIMIT 3000`),

    db.query(`
      SELECT id, name, email, phone, budget_min_cents, budget_max_cents, bedrooms_needed,
             preferred_neighborhoods, move_in_date, status, notes, created_at
      FROM prospects WHERE deleted_at IS NULL ORDER BY name`),
  ])

  return {
    clients: clients.rows.map((r) => ({
      id: r.id, name: r.name, unitCount: Number(r.units), isModelB: !!r.is_model_b,
    })),
    listings: listings.rows.map((r) => {
      const oc = (r.other_criteria ?? {}) as Record<string, unknown>
      return {
        id: r.id,
        clientId: r.org_id,
        clientName: r.client_name,
        propertyId: r.property_id,
        address: r.address,
        city: r.city,
        unit: r.unit,
        rentCents: n(r.rent_cents),
        bedrooms: n(r.bedrooms),
        bathrooms: r.bathrooms === null ? null : String(r.bathrooms),
        neighborhood: (oc.neighborhood as string) ?? null,
        incomeRequirement: (oc.income_requirement_raw as string) ?? null,
        features: Array.isArray(oc.features) ? (oc.features as string[]) : [],
        securityDepositCents: n(oc.security_deposit_cents),
        availableFrom: r.available_from ? new Date(r.available_from).toISOString().slice(0, 10) : null,
        status: r.status,
        // This schema has no separate publish flag — status IS the visibility
        // gate (PUBLIC_UNIT_VISIBILITY_SQL gates on status='active'), so the
        // original's toggle maps onto that rather than a second field that
        // could disagree with it.
        isPublished: r.status === 'active',
        daysOnMarket: n(r.days_on_market),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }
    }),
    prospects: prospects.rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      budgetMinCents: n(r.budget_min_cents),
      budgetMaxCents: n(r.budget_max_cents),
      bedroomsNeeded: n(r.bedrooms_needed),
      neighborhoods: Array.isArray(r.preferred_neighborhoods) ? r.preferred_neighborhoods : [],
      moveInDate: r.move_in_date ? new Date(r.move_in_date).toISOString().slice(0, 10) : null,
      status: r.status,
      notes: r.notes,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  }
}
