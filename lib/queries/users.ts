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
  /** Neighborhoods picked during onboarding — up to 3. JSONB in the database,
   *  not text[], so it needs jsonb handling rather than unnest. */
  preferredNeighborhoods: string[]
  preferredBedrooms: number | null
  preferredMaxRent: number | null
  preferredMinRent: number | null
  moveInWindow: string | null
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
           rp.preferred_min_rent, rp.preferred_neighborhoods, rp.move_in_window,
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
    preferredNeighborhoods: Array.isArray(r.preferred_neighborhoods) ? r.preferred_neighborhoods : [],
    preferredBedrooms: n(r.preferred_bedrooms),
    preferredMaxRent: n(r.preferred_max_rent),
    preferredMinRent: n(r.preferred_min_rent),
    moveInWindow: r.move_in_window,
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
  /** Verified income nobody should act on before a human checks it. */
  implausibleIncome: AdminUserRow[]
  noConnections: number
}

/**
 * Verified income high enough that nobody should act on it without a human
 * looking first.
 *
 * Not a wealth filter. A renter genuinely earning this is not qualifying for
 * an apartment through a 40x check, so a figure this size means the pipeline
 * read something that is not wage income -- a brokerage account, a business
 * account, proceeds from a sale.
 *
 * The case this was written for: a renter reading $3.46m a year, on a live
 * application, from 16 income sources of which 15 were single deposits
 * ($151,500, $138,488, $138,188 ...) each divided by a 90-day window as
 * though it recurred quarterly. The deposits were real; calling them a salary
 * was not.
 *
 * Measured against production before shipping: catches 1 of 40 verified
 * renters, and the next highest sits at $300,000 -- an eleven-fold gap, so
 * there is no plausible renter near this line.
 */
const IMPLAUSIBLE_ANNUAL_INCOME_CENTS = 100_000_000 // $1,000,000

/**
 * Or: income wildly out of proportion to the rent they are actually shopping
 * for. A renter qualifies at 40x, and real ones here sit at 36-46x. Ten times
 * the bar is not a wealthy renter, it is a number to check by hand.
 *
 * Kept alongside the absolute ceiling because most renters have no stated
 * budget to compare against, and the ceiling still catches those.
 */
const IMPLAUSIBLE_RENT_MULTIPLE = 400

export function flagUsers(users: AdminUserRow[]): FlaggedGroups {
  const days = (iso: string | null) =>
    iso === null ? Infinity : (Date.now() - new Date(iso).getTime()) / 86_400_000

  const renters = users.filter((u) => u.role === 'renter')
  return {
    // Registered, then never signed in again.
    neverReturned: renters.filter((u) => u.sessions <= 1 && days(u.createdAt) > 3),
    // Onboarded but told us nothing to match on.
    noPreferences: renters.filter(
      (u) => u.onboarded && !u.preferredCity && !u.preferredBedrooms
             && !u.preferredMaxRent && u.preferredNeighborhoods.length === 0),
    emailUnverified: users.filter((u) => !u.emailVerified),
    // Was active, then silent for two weeks.
    wentQuiet: renters.filter((u) => u.sessions > 1 && days(u.lastActive) > 14),
    // Began verifying and stopped — the most recoverable cohort.
    startedNotFinishedVerification: renters.filter(
      (u) => (u.incomeVerified || u.identityVerified) && !(u.incomeVerified && u.identityVerified)),
    // Flagged for manual review rather than corrected automatically: the
    // deposits behind a figure like this are real, and whether they count as
    // income is a judgement about the account, not arithmetic.
    implausibleIncome: renters.filter((u) => {
      const cents = u.verifiedIncomeCents
      if (!u.incomeVerified || cents === null || cents <= 0) return false
      if (cents > IMPLAUSIBLE_ANNUAL_INCOME_CENTS) return true
      // preferred_max_rent is a MONTHLY figure in cents, so the multiple is
      // annual income over monthly rent -- the same 40x the brokers quote.
      const monthlyRent = u.preferredMaxRent
      if (monthlyRent === null || monthlyRent <= 0) return false
      return cents / monthlyRent > IMPLAUSIBLE_RENT_MULTIPLE
    }),
    noConnections: renters.filter((u) => u.connections === 0).length,
  }
}
