// The one access layer that is NOT rooted in the database.
//
// Everything else about admin access lives in Postgres: the session row, the
// platform_role, the validate_admin_session() function. That means a single bug
// anywhere with UPDATE rights on user_profiles could mint an admin. This list
// lives in the deployment's env instead, so that bug still isn't enough.
//
// Fails closed: an unset or empty allowlist admits nobody.

function parseList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAllowlistedEmail(email: string | null | undefined): boolean {
  const list = parseList(process.env.ADMIN_EMAIL_ALLOWLIST)
  if (list.size === 0) return false
  if (!email) return false
  return list.has(email.trim().toLowerCase())
}

export function isAllowedHost(host: string | null | undefined): boolean {
  const list = parseList(process.env.ADMIN_ALLOWED_HOSTS)
  if (list.size === 0) return false
  if (!host) return false
  return list.has(host.trim().toLowerCase())
}
