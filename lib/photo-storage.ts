import 'server-only'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

// Apartment photos on Cloudflare R2 — PRIVATE bucket, authenticated reads.
//
// ── Why private, when these are marketing photos ──────────────────────────
// A public bucket on a custom domain would be cheaper and simpler, and was the
// first plan. It was changed on request: nobody outside the platform should be
// able to open a listing photo. Public + authenticated-only are mutually
// exclusive, so this is private with short-lived signed reads.
//
// What that genuinely buys:
//   * no unauthenticated access — a URL alone is not enough, it must be signed
//   * no enumeration — keys are content hashes, not sequential ids
//   * no hotlinking from another site
//   * a leaked URL dies on its own within minutes
//
// What it cannot buy, stated plainly: a renter who is allowed to SEE a photo
// can always save it — right-click, screenshot, or read it from the network
// tab. That is true of every image on every website and no storage
// configuration changes it. What the metadata stripping below does is make sure
// a saved copy carries nothing beyond the pixels.
//
// ── Why uploads go through the server ─────────────────────────────────────
// Presigned direct-to-R2 upload is faster and was the first design, but the
// server never sees the bytes — so it cannot strip EXIF, and EXIF on a property
// photo routinely carries GPS coordinates, the camera's serial number and the
// photographer's name. Uploads therefore pass through the server, where sharp
// re-encodes every image and writes no metadata at all.
//
// Separate module from lib/s3.ts on purpose: that one holds renter documents
// (regulated records, different bucket, different lifecycle). One module per
// access model means a change to document handling cannot accidentally expose a
// pay stub, or the reverse.
//
// Env — see docs/R2_SETUP.md:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   R2_PHOTOS_BUCKET  — defaults to 'nessoo-listing-photos'
//
// Unconfigured is a supported state: photosEnabled() is false, uploads say so,
// and the renter side renders exactly as it does today.

const DEFAULT_BUCKET = 'nessoo-listing-photos'

/** Seconds a signed read URL stays valid. Short enough that a leaked link is
 *  near-useless, long enough to load a gallery and sit on the page a while. */
export const READ_URL_TTL = 900   // 15 minutes

/** Long edge of a stored image. Anything larger is downscaled — a 4000px phone
 *  photo costs bandwidth on every view and shows no more of the apartment. */
const MAX_EDGE = 2000
const THUMB_EDGE = 480

export const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
/** Cap on what may be POSTed. Vercel's serverless body limit is 4.5 MB, so this
 *  sits under it deliberately — a larger file is refused with a clear message
 *  rather than dying in the platform with a generic 413. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

let _client: S3Client | null = null

export function photosEnabled(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID?.trim() &&
    process.env.R2_ACCESS_KEY_ID?.trim() &&
    process.env.R2_SECRET_ACCESS_KEY?.trim()
  )
}

function bucket(): string {
  return process.env.R2_PHOTOS_BUCKET?.trim() || DEFAULT_BUCKET
}

function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      // R2 ignores region, but the SDK requires one; 'auto' is what Cloudflare
      // documents for S3-compatible clients.
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID!.trim()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      },
    })
  }
  return _client
}

export interface ProcessedPhoto {
  full: Buffer
  thumb: Buffer
  width: number
  height: number
  contentType: 'image/webp'
}

/**
 * Re-encode to WebP, strip every byte of metadata, downscale, and produce a
 * thumbnail.
 *
 * The stripping is by construction rather than by removal: sharp writes no
 * metadata unless `withMetadata()` is called, and it is never called here. So
 * EXIF, GPS, XMP, IPTC and the ICC profile are all simply absent from the
 * output — there is no blocklist to keep up to date as new tag types appear.
 *
 * `.rotate()` with no argument is load-bearing: it applies the EXIF orientation
 * flag and then discards it. Without it, stripping EXIF would leave phone
 * photos rotated 90° because the flag that told the browser to turn them is
 * gone while the pixels never moved.
 *
 * Verified against a JPEG carrying Copyright, Make and GPS tags: exif, icc and
 * xmp all read false afterwards.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const probe = await sharp(input).metadata()
  if (!probe.width || !probe.height) throw new Error('not a readable image')

  const base = sharp(input).rotate()

  const full = await base
    .clone()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()

  const thumb = await base
    .clone()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 74 })
    .toBuffer()

  // Dimensions of what was actually stored, not of the input.
  const out = await sharp(full).metadata()
  return {
    full, thumb,
    width: out.width ?? probe.width,
    height: out.height ?? probe.height,
    contentType: 'image/webp',
  }
}

/** Confirms the stored object really carries no metadata. Cheap, and it means
 *  a future change to processPhoto cannot silently start leaking EXIF. */
export async function assertNoMetadata(buf: Buffer): Promise<void> {
  const m = await sharp(buf).metadata()
  if (m.exif || m.xmp || m.iptc || m.icc) {
    throw new Error('refusing to store an image that still carries metadata')
  }
}

/**
 * Content-addressed key. Identical bytes collapse to one object, a changed
 * photo is a new key, and nothing is guessable from a sequential id — which
 * matters more here than usual, since guessing a key is the only way to attempt
 * access without a signature.
 */
export function photoKeys(unitId: string, bytes: Buffer): { full: string; thumb: string } {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  return {
    full: `units/${unitId}/${hash}.webp`,
    thumb: `units/${unitId}/${hash}_t.webp`,
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
    // Private bucket, so this is only about the browser's own cache once a
    // signed URL has been followed. Keys are content-addressed, so a cached
    // image can never be the wrong one.
    CacheControl: 'private, max-age=31536000, immutable',
  }))
}

/**
 * Signed read URL. The browser then fetches straight from R2, so renter image
 * traffic never passes through Vercel — the auth check happens once, server
 * side, when the URL is minted.
 *
 * NOTE deliberately not signing extra headers here. lib/s3.ts documents the
 * trap the hard way: anything added to SignedHeaders must be echoed back by the
 * browser byte-for-byte, and browsers do not, which produces
 * SignatureDoesNotMatch on every request.
 */
export async function signedPhotoUrl(key: string, ttl = READ_URL_TTL): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: ttl },
  )
}

export async function deleteObjects(keys: string[]): Promise<void> {
  // One at a time rather than DeleteObjects: a handful of keys per photo, and a
  // partial batch failure is harder to reason about than a loop.
  for (const key of keys) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {
      // A missing object is already the desired state. The database row is the
      // record of truth; an orphaned object costs a fraction of a cent.
    })
  }
}
