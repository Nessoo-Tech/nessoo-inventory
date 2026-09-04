import 'server-only'
import { headers } from 'next/headers'
import type { Actor } from './queries/inventory'
import type { AdminUser } from './session'

export function actorFrom(user: AdminUser): Actor {
  const h = headers()
  // Vercel puts the real client IP in x-forwarded-for; take the first hop.
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return {
    id: user.id,
    ip: forwarded || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent'),
  }
}
