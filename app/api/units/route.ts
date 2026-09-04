import { NextResponse } from 'next/server'
import { adminWrite, readJson } from '@/lib/api'
import { createUnit } from '@/lib/queries/inventory'

export const dynamic = 'force-dynamic'

export const POST = adminWrite(async ({ actor, req }) => {
  const body = await readJson(req)
  const id = await createUnit(actor, body as never)
  return NextResponse.json({ id }, { status: 201 })
})
