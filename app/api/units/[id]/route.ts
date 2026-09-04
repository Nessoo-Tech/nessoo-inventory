import { NextResponse } from 'next/server'
import { adminWrite, readJson } from '@/lib/api'
import { updateUnit, archiveUnit } from '@/lib/queries/inventory'

export const dynamic = 'force-dynamic'

export const PATCH = adminWrite(async ({ actor, req, params }) => {
  const patch = await readJson(req)
  await updateUnit(actor, params.id, patch as never)
  return NextResponse.json({ ok: true })
})

export const DELETE = adminWrite(async ({ actor, req, params }) => {
  // A reason is mandatory. Archiving another company's inventory is the most
  // consequential thing this tool can do; the audit row has to say why.
  const body = await readJson(req)
  await archiveUnit(actor, params.id, String(body.reason ?? ''))
  return NextResponse.json({ ok: true })
})
