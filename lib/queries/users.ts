import 'server-only'
import { db } from '../db'

// Platform-wide user directory for the admin console.
//
// "user" is the ground truth for who exists — profile rows are created lazily on
// a user's first authenticated action, so anyone who registered and never came
// back has NO profile row. Everything profile-derived is therefore LEFT JOINed
// and nullable; treating a missing row as "no data" rather than excluding the
// user is what keeps the totals honest.

export interface AdminUserRow {
  id: string
  name: string | null
  email: string
  emailVerified: boolean
  role: string
  createdAt: string
  phone: string | null
  market: string | null
  signupHost: string | null
  marketBackfilled: boolean
  onboarded: boolean
  identityVerified: boolean
  incomeVerified: boolean
  verifiedIncomeCents: number | null
  readiness: number | null
  preferredCity: string | null
  preferredBedrooms: number | null
  preferredMaxRent: number | null
  connections: number
  requests: number
  lastActive: string | null
  sessions: number
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function listUsers(): Promise<AdminUserRow[]> {
  const { rows } = await db.query(`
    SELECT u.id, u.name, u.email, u."emailVerified", u.role, u."createdAt",
           COALESCE(rp.phone, up.phone)            AS phone,
           up.signup_market, up.signup_host, up.signup_market_backfilled,
           up.onboarding_completed, up.platform_role,
           rp.identity_verified, rp.income_verified, rp.verified_income_cents,
           rp.readiness_score, rp.preferred_city, rp.preferred_bedrooms, rp.preferred_max_rent,
           (SELECT COUNT(*) FROM connections c
              WHERE c.renter_id = u.id AND c.access_revoked_at IS NULL)::int AS connections,
           (SELECT COUNT(*) FROM connection_requests r WHERE r.renter_id = u.id)::int AS requests,
           (SELECT MAX(s."createdAt") FROM session s WHERE s."userId" = u.id)  AS last_active,
           (SELECT COUNT(*) FROM session s WHERE s."userId" = u.id)::int       AS sessions
    FROM "user" u
    LEFT JOIN user_profiles   up ON up.user_id = u.id
    LEFT JOIN renter_profiles rp ON rp.user_id = u.id
    ORDER BY u."createdAt" DESC
    LIMIT 5000`)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: !!r.emailVerified,
    // platform_role is server-set and authoritative; u.role is the Better Auth
    // field the user themselves once chose.
    role: r.platform_role ?? r.role ?? 'renter',
    createdAt: new Date(r.createdAt).toISOString(),
    phone: r.phone,
    market: r.signup_market,
    signupHost: r.signup_host,
    marketBackfilled: !!r.signup_market_backfilled,
    onboarded: !!r.onboarding_completed,
    identityVerified: !!r.identity_verified,
    incomeVerified: !!r.income_verified,
    verifiedIncomeCents: n(r.verified_income_cents),
    readiness: n(r.readiness_score),
    preferredCity: r.preferred_city,
    preferredBedrooms: n(r.preferred_bedrooms),
    preferredMaxRent: n(r.preferred_max_rent),
    connections: Number(r.connections),
    requests: Number(r.requests),
    lastActive: r.last_active ? new Date(r.last_active).toISOString() : null,
    sessions: Number(r.sessions),
  }))
}

/**
 * The "flagged" cohorts. The original dashboard hand-wrote these as prose with
 * no rule behind them; these are real, stated rules so the numbers mean
 * something and can be argued with.
 */
export interface FlaggedGroups {
  neverReturned: AdminUserRow[]
  noPreferences: AdminUserRow[]
  emailUnverified: AdminUserRow[]
  wentQuiet: AdminUserRow[]
  startedNotFinishedVerification: AdminUserRow[]
  noConnections: number
}

export function flagUsers(users: AdminUserRow[]): FlaggedGroups {
  const days = (iso: string | null) =>
    iso === null ? Infinity : (Date.now() - new Date(iso).getTime()) / 86_400_000

  const renters = users.filter((u) => u.role === 'renter')
  return {
    // Registered, then never signed in again.
    neverReturned: renters.filter((u) => u.sessions <= 1 && days(u.createdAt) > 3),
    // Onboarded but told us nothing to match on.
    noPreferences: renters.filter(
      (u) => u.onboarded && !u.preferredCity && !u.preferredBedrooms && !u.preferredMaxRent),
    emailUnverified: users.filter((u) => !u.emailVerified),
    // Was active, then silent for two weeks.
    wentQuiet: renters.filter((u) => u.sessions > 1 && days(u.lastActive) > 14),
    // Began verifying and stopped — the most recoverable cohort.
    startedNotFinishedVerification: renters.filter(
      (u) => (u.incomeVerified || u.identityVerified) && !(u.incomeVerified && u.identityVerified)),
    noConnections: renters.filter((u) => u.connections === 0).length,
  }
}
