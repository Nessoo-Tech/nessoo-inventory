import 'server-only'
import { db } from '../db'
import type { PoolClient } from 'pg'
import {
  processPhoto, assertNoMetadata, photoKeys, putObject, deleteObjects,
  signedPhotoUrl, photosEnabled, ALLOWED_PHOTO_TYPES, MAX_UPLOAD_BYTES,
} from '../photo-storage'
import type { Actor } from './inventory'

export interface UnitPhoto {
  id: string
  unitId: string
  /** Signed, time-limited. Never a bare bucket path — the bucket is private. */
  url: string | null
  thumbUrl: string | null
  width: number | null
  height: number | null
  alt: string | null
  sortOrder: number
  createdAt: string
}

export class PhotoError extends Error {}

/** Signed URLs for one unit's photos, cover first. */
export async function listUnitPhotos(unitId: string): Promise<UnitPhoto[]> {
  const { rows } = await db.query(`
    SELECT id, unit_id, storage_key, thumb_storage_key, width, height, alt, sort_order, created_at
    FROM unit_photos WHERE unit_id = $1 ORDER BY sort_order, created_at`, [unitId])
  return withSignedUrls(rows)
}

/** Cover image per unit, for grids. One query, not N. */
export async function coverPhotos(unitIds: string[]): Promise<Map<string, UnitPhoto>> {
  const ids = Array.from(new Set(unitIds.filter(Boolean)))
  if (!ids.length || !photosEnabled()) return new Map()
  const { rows } = await db.query(`
    SELECT DISTINCT ON (unit_id)
           id, unit_id, storage_key, thumb_storage_key, width, height, alt, sort_order, created_at
    FROM unit_photos WHERE unit_id = ANY($1::text[])
    ORDER BY unit_id, sort_order, created_at`, [ids])
  const signed = await withSignedUrls(rows)
  return new Map(signed.map((p) => [p.unitId, p]))
}

/** How many photos each unit has — cheap enough to fetch for the whole list. */
export async function photoCounts(): Promise<Map<string, number>> {
  const { rows } = await db.query(
    `SELECT unit_id, COUNT(*)::int AS n FROM unit_photos GROUP BY unit_id`)
  return new Map(rows.map((r) => [r.unit_id as string, Number(r.n)]))
}

async function withSignedUrls(rows: Record<string, unknown>[]): Promise<UnitPhoto[]> {
  const enabled = photosEnabled()
  return Promise.all(rows.map(async (r) => ({
    id: String(r.id),
    unitId: String(r.unit_id),
    // Signing is a local HMAC — no network call — so doing it per row is fine.
    url: enabled ? await signedPhotoUrl(String(r.storage_key)) : null,
    thumbUrl: enabled
      // Rows predating the thumbnail column fall back to the full image rather
      // than rendering a gap.
      ? await signedPhotoUrl(String(r.thumb_storage_key ?? r.storage_key))
      : null,
    width: r.width === null ? null : Number(r.width),
    height: r.height === null ? null : Number(r.height),
    alt: (r.alt as string) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: new Date(r.created_at as string).toISOString(),
  })))
}

async function audit(
  client: PoolClient, actor: Actor, action: 'create' | 'update' | 'delete',
  objectId: string, orgId: string | null, metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_events
       (actor_id, org_id, action, object_type, object_id, ip_address, user_agent, metadata)
     VALUES ($1,$2,$3::audit_action,'unit_photo',$4,$5,$6,$7::jsonb)`,
    [actor.id, orgId, action, objectId, actor.ip ?? null,
     actor.userAgent ? actor.userAgent.slice(0, 400) : null,
     JSON.stringify({ ...metadata, surface: 'admin.nessoo.com' })])
}

/**
 * Store one photo.
 *
 * The bytes are re-encoded before they are stored, which is the whole reason
 * uploads pass through the server: it strips EXIF/GPS/XMP/IPTC/ICC, applies the
 * orientation flag before discarding it, downscales, and emits a thumbnail.
 * assertNoMetadata then re-reads the output and refuses to store anything that
 * somehow still carries metadata — so a future change to the processing cannot
 * silently start leaking it.
 */
export async function addUnitPhoto(actor: Actor, input: {
  unitId: string
  bytes: Buffer
  contentType: string
  alt?: string | null
}): Promise<UnitPhoto> {
  if (!photosEnabled()) {
    throw new PhotoError('Photo storage is not configured yet — add the R2 credentials first.')
  }
  if (!ALLOWED_PHOTO_TYPES.has(input.contentType)) {
    throw new PhotoError('Images must be JPEG, PNG, WebP or AVIF.')
  }
  if (input.bytes.length === 0) throw new PhotoError('That file is empty.')
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw new PhotoError(`Images must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }

  // Confirm the unit exists (and capture its org) before touching storage, so a
  // bad id cannot leave an orphaned object behind.
  const { rows: unit } = await db.query(
    `SELECT org_id FROM units WHERE id = $1 AND deleted_at IS NULL`, [input.unitId])
  if (!unit.length) throw new PhotoError('That unit no longer exists.')
  const orgId = unit[0].org_id as string

  let processed
  try {
    processed = await processPhoto(input.bytes)
  } catch {
    throw new PhotoError('That file could not be read as an image.')
  }
  await assertNoMetadata(processed.full)
  await assertNoMetadata(processed.thumb)

  const keys = photoKeys(input.unitId, processed.full)

  // Storage first: an orphaned object is harmless, whereas a row pointing at a
  // missing object renders a broken image.
  await putObject(keys.full, processed.full, processed.contentType)
  await putObject(keys.thumb, processed.thumb, processed.contentType)

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows: [next] } = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM unit_photos WHERE unit_id = $1`,
      [input.unitId])

    const { rows } = await client.query(`
      INSERT INTO unit_photos
        (unit_id, storage_key, thumb_storage_key, content_type, bytes, width, height,
         alt, sort_order, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (unit_id, storage_key) DO UPDATE
        SET alt = EXCLUDED.alt, updated_at = NOW()
      RETURNING id, unit_id, storage_key, thumb_storage_key, width, height, alt, sort_order, created_at`,
      [input.unitId, keys.full, keys.thumb, processed.contentType, processed.full.length,
       processed.width, processed.height, input.alt?.trim() || null,
       Number(next.n), actor.id])

    await audit(client, actor, 'create', String(rows[0].id), orgId, {
      unitId: input.unitId, bytes: processed.full.length,
      dimensions: `${processed.width}x${processed.height}`, metadataStripped: true,
    })
    await client.query('COMMIT')
    return (await withSignedUrls(rows))[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    // The row failed, so the objects we just wrote are unreferenced. Remove them.
    await deleteObjects([keys.full, keys.thumb])
    throw e
  } finally {
    client.release()
  }
}

/** Hard delete — a soft-deleted photo would still occupy the ordering, and
 *  there is no history worth preserving in a wrong image. */
export async function deleteUnitPhoto(actor: Actor, photoId: string): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      DELETE FROM unit_photos p USING units u
      WHERE p.id = $1 AND u.id = p.unit_id
      RETURNING p.storage_key, p.thumb_storage_key, p.unit_id, u.org_id`, [photoId])
    if (!rows.length) throw new PhotoError('That photo no longer exists.')

    await audit(client, actor, 'delete', photoId, rows[0].org_id as string,
      { unitId: rows[0].unit_id })
    await client.query('COMMIT')

    // After the commit: if this fails the row is already gone, and an orphaned
    // object costs a fraction of a cent. Doing it before would risk deleting
    // the image while the row survives — a broken thumbnail on a live listing.
    await deleteObjects([
      String(rows[0].storage_key),
      ...(rows[0].thumb_storage_key ? [String(rows[0].thumb_storage_key)] : []),
    ])
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Reorder. The first id becomes the cover image. */
export async function reorderUnitPhotos(
  actor: Actor, unitId: string, photoIds: string[],
): Promise<void> {
  if (!photoIds.length) throw new PhotoError('Nothing to reorder.')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // Scoped to the unit, so a foreign id in the list cannot reorder another
    // apartment's gallery.
    for (let i = 0; i < photoIds.length; i++) {
      await client.query(
        `UPDATE unit_photos SET sort_order = $1, updated_at = NOW()
         WHERE id = $2 AND unit_id = $3`, [i, photoIds[i], unitId])
    }
    const { rows: unit } = await client.query(`SELECT org_id FROM units WHERE id = $1`, [unitId])
    await audit(client, actor, 'update', unitId, unit[0]?.org_id ?? null,
      { reordered: photoIds.length, cover: photoIds[0] })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function setPhotoAlt(actor: Actor, photoId: string, alt: string | null): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE unit_photos SET alt = $2, updated_at = NOW() WHERE id = $1
       RETURNING unit_id`, [photoId, alt?.trim() || null])
    if (!rows.length) throw new PhotoError('That photo no longer exists.')
    const { rows: unit } = await client.query(
      `SELECT org_id FROM units WHERE id = $1`, [rows[0].unit_id])
    await audit(client, actor, 'update', photoId, unit[0]?.org_id ?? null, { alt })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
