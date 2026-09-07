import { NextResponse } from 'next/server'
import { adminWrite, readJson } from '@/lib/api'
import { requireAdmin, adminAuthErrorResponse } from '@/lib/session'
import { assertSameOrigin, OriginError } from '@/lib/origin'
import { actorFrom } from '@/lib/actor'
import { addUnitPhoto, listUnitPhotos, reorderUnitPhotos, PhotoError } from '@/lib/queries/photos'
import { MAX_UPLOAD_BYTES } from '@/lib/photo-storage'

export const dynamic = 'force-dynamic'
// Uploads carry image bytes, so the default body parsing is not enough — the
// route reads multipart directly via request.formData().
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin()
  } catch (e) {
    const { body, status } = adminAuthErrorResponse(e)
    return NextResponse.json(body, { status })
  }
  return NextResponse.json({ photos: await listUnitPhotos(params.id) })
}

/**
 * Upload. Multipart rather than JSON so the browser can send the raw file, and
 * server-side rather than a presigned direct-to-R2 PUT specifically so the
 * bytes pass through here and their metadata can be stripped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin()
  } catch (e) {
    if (e instanceof OriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    throw e
  }

  let user
  try {
    user = await requireAdmin()
  } catch (e) {
    const { body, status } = adminAuthErrorResponse(e)
    return NextResponse.json(body, { status })
  }

  try {
    const form = await req.formData()
    const files = form.getAll('file').filter((f): f is File => f instanceof File)
    if (!files.length) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const actor = actorFrom(user)
    const added = []
    const failed: { name: string; reason: string }[] = []

    // One at a time, reporting per-file outcomes: a single bad image in a
    // multi-select should not discard the rest of the batch.
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        failed.push({ name: file.name, reason: `over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` })
        continue
      }
      try {
        added.push(await addUnitPhoto(actor, {
          unitId: params.id,
          bytes: Buffer.from(await file.arrayBuffer()),
          contentType: file.type,
          alt: (form.get('alt') as string) ?? null,
        }))
      } catch (e) {
        failed.push({ name: file.name, reason: e instanceof PhotoError ? e.message : 'could not be stored' })
      }
    }

    if (!added.length && failed.length) {
      return NextResponse.json({ error: failed[0].reason, failed }, { status: 400 })
    }
    return NextResponse.json({ photos: added, failed }, { status: 201 })
  } catch (e) {
    if (e instanceof PhotoError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[admin] photo upload failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

/** Reorder — the first id becomes the cover image. */
export const PATCH = adminWrite(async ({ actor, req, params }) => {
  const body = await readJson(req)
  const ids = Array.isArray(body.photoIds) ? body.photoIds.map(String) : []
  await reorderUnitPhotos(actor, params.id, ids)
  return NextResponse.json({ ok: true })
})
