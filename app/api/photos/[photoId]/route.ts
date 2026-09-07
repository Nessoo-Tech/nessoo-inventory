import { NextResponse } from 'next/server'
import { adminWrite, readJson } from '@/lib/api'
import { deleteUnitPhoto, setPhotoAlt } from '@/lib/queries/photos'

export const dynamic = 'force-dynamic'

export const DELETE = adminWrite(async ({ actor, params }) => {
  await deleteUnitPhoto(actor, params.photoId)
  return NextResponse.json({ ok: true })
})

export const PATCH = adminWrite(async ({ actor, req, params }) => {
  const body = await readJson(req)
  await setPhotoAlt(actor, params.photoId, typeof body.alt === 'string' ? body.alt : null)
  return NextResponse.json({ ok: true })
})
