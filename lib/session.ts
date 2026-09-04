import 'server-only'
import { cookies, headers } from 'next/headers'
import { db } from './db'
import { isAllowlistedEmail, isAllowedHost } from './allowlist'
import { extractSessionToken } from './session-token'

export { extractSessionToken }

// THE auth boundary for admin.nessoo.com.
//
// This app does not run its own Better Auth server and never verifies the
// cookie's HMAC locally — so BETTER_AUTH_SECRET is never copied into this
// deployment. The security boundary is "does this exact token exist as a live
// session row", which validate_admin_session() answers authoritatively. That
// function is also the single definition of "valid admin session" shared with
// homey-ux, so the two apps cannot drift apart on what admin means.
//
// The lookup is live on every request with no caching, which is what keeps
// sign-out revocation immediate (homey-ux sets cookieCache: { enabled: false }
// for the same reason).

// Better Auth prefixes the cookie with __Secure- whenever baseURL is https,
// which it is in production. Dev over http gets the bare name.
const COOKIE_NAMES = ['__Secure-better-auth.session_token', 'better-auth.session_token']

export interface AdminUser {
  id: string
  email: string
  name: string
  role: string
}

export type AdminAuthResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: 'no_session' | 'not_admin' | 'not_allowlisted' | 'bad_host' }

export class AdminAuthError extends Error {
  status: 401 | 403
  constructor(status: 401 | 403, message: string) {
    super(message)
    this.status = status
  }
}

function readSessionToken(): string | null {
  const jar = cookies()
  for (const name of COOKIE_NAMES) {
    const token = extractSessionToken(jar.get(name)?.value)
    if (token) return token
  }
  return null
}

export async function resolveAdmin(): Promise<AdminAuthResult> {
  // Host check first: an unauthenticated copy of this app reachable on a
  // *.vercel.app preview URL is a real leak vector that no session check sees.
  if (!isAllowedHost(headers().get('host'))) return { ok: false, reason: 'bad_host' }

  const token = readSessionToken()
  if (!token) return { ok: false, reason: 'no_session' }

  // validate_admin_session() returns zero rows unless the session is live,
  // unexpired, AND the user's platform_role is super_admin.
  const { rows } = await db.query<{
    user_id: string
    email: string
    name: string
    platform_role: string
  }>('SELECT user_id, email, name, platform_role FROM validate_admin_session($1)', [token])

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_admin' }

  if (!isAllowlistedEmail(row.email)) return { ok: false, reason: 'not_allowlisted' }

  return {
    ok: true,
    user: { id: row.user_id, email: row.email, name: row.name, role: row.platform_role },
  }
}

/** For API routes. Throws AdminAuthError; pair with adminAuthErrorResponse(). */
export async function requireAdmin(): Promise<AdminUser> {
  const result = await resolveAdmin()
  if (result.ok) return result.user
  throw new AdminAuthError(result.reason === 'no_session' ? 401 : 403, result.reason)
}

export function adminAuthErrorResponse(e: unknown) {
  if (e instanceof AdminAuthError) return { body: { error: e.message }, status: e.status }
  return { body: { error: 'internal error' }, status: 500 as const }
}
