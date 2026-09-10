// POST /api/clients — add a client (an `organizations` row).
//
// The only write in this console that creates a TENANT rather than a row
// inside one, so the guardrails live in createClient: is_model_b is forced
// false, and the DB role has INSERT but deliberately not UPDATE or DELETE on
// organizations. See lib/queries/inventory.ts::createClient.

import { NextResponse } from 'next/server'
import { adminWrite, readJson } from '@/lib/api'
import { createClient } from '@/lib/queries/inventory'

export const dynamic = 'force-dynamic'

export const POST = adminWrite(async ({ actor, req }) => {
  const body = await readJson(req)
  const id = await createClient(actor, body as never)
  return NextResponse.json({ id }, { status: 201 })
})
