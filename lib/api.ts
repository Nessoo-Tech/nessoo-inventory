import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin, adminAuthErrorResponse, type AdminUser } from './session'
import { assertSameOrigin, OriginError } from './origin'
import { actorFrom } from './actor'
import { ValidationError, type Actor } from './queries/inventory'

/**
 * One wrapper for every state-changing endpoint, so a new route cannot forget
 * a check. Order matters: same-origin first (cheapest, and rejects a CSRF
 * attempt before it can touch the database), then identity, then the handler.
 *
 * Error shape is deliberately uninformative — an admin console should not tell
 * an unauthenticated caller which gate they failed.
 */
export function adminWrite(
  handler: (ctx: { user: AdminUser; actor: Actor; req: Request; params: Record<string, string> }) => Promise<NextResponse>,
) {
  return async (req: Request, ctx?: { params?: Record<string, string> }) => {
    try {
      assertSameOrigin()
    } catch (e) {
      if (e instanceof OriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      throw e
    }

    let user: AdminUser
    try {
      user = await requireAdmin()
    } catch (e) {
      const { body, status } = adminAuthErrorResponse(e)
      return NextResponse.json(body, { status })
    }

    try {
      return await handler({ user, actor: actorFrom(user), req, params: ctx?.params ?? {} })
    } catch (e) {
      if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
      // Log the message only. A full error object from pg can carry row values
      // from the failing statement, which is real user data going to a log.
      console.error('[admin] write failed:', e instanceof Error ? e.message : 'unknown')
      return NextResponse.json({ error: 'request failed' }, { status: 500 })
    }
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('body must be a JSON object')
    }
    return body as Record<string, unknown>
  } catch (e) {
    if (e instanceof ValidationError) throw e
    throw new ValidationError('body must be valid JSON')
  }
}
