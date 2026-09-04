import { NextResponse } from 'next/server'
import { requireAdmin, adminAuthErrorResponse } from '@/lib/session'
import { actorFrom } from '@/lib/actor'
import { updateUnit, archiveUnit, ValidationError } from '@/lib/queries/inventory'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let user
  try {
    user = await requireAdmin()
  } catch (e) {
    const { body, status } = adminAuthErrorResponse(e)
    return NextResponse.json(body, { status })
  }

  try {
    const patch = await req.json()
    await updateUnit(actorFrom(user), params.id, patch)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[admin] updateUnit failed', e)
    return NextResponse.json({ error: 'could not update unit' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  let user
  try {
    user = await requireAdmin()
  } catch (e) {
    const { body, status } = adminAuthErrorResponse(e)
    return NextResponse.json(body, { status })
  }

  try {
    // A reason is mandatory. Archiving someone else's inventory is the most
    // consequential thing this tool can do; the audit row must say why.
    const { reason } = await req.json().catch(() => ({ reason: '' }))
    await archiveUnit(actorFrom(user), params.id, reason)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[admin] archiveUnit failed', e)
    return NextResponse.json({ error: 'could not archive unit' }, { status: 500 })
  }
}
