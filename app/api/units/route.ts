import { NextResponse } from 'next/server'
import { requireAdmin, adminAuthErrorResponse } from '@/lib/session'
import { actorFrom } from '@/lib/actor'
import { createUnit, ValidationError } from '@/lib/queries/inventory'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let user
  try {
    user = await requireAdmin()
  } catch (e) {
    const { body, status } = adminAuthErrorResponse(e)
    return NextResponse.json(body, { status })
  }

  try {
    const body = await req.json()
    const id = await createUnit(actorFrom(user), body)
    return NextResponse.json({ id }, { status: 201 })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[admin] createUnit failed', e)
    return NextResponse.json({ error: 'could not create unit' }, { status: 500 })
  }
}
