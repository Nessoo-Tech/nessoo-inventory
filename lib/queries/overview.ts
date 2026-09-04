import 'server-only'
import { db } from '../db'

// Platform-wide analytics. Every figure here is backed by a real query against
// production RDS — nothing is estimated, sampled or mocked. Where the data
// genuinely cannot answer a question, there is no number rather than a guess.
//
// Query shapes follow homey-ux/backend/queries/analytics.ts (zero-filled
// generate_series buckets, FILTER (WHERE ...) aggregates), minus its org_id
// scoping, since this is the cross-org view.

export interface DayPoint {
  day: string
  count: number
}

export interface Overview {
  signups: {
    total: number
    last7: number
    last30: number
    series: DayPoint[]
    byRole: { role: string; count: number }[]
    byMarket: { market: string; count: number }[]
  }
  activity: {
    dau: DayPoint[]
    activeLast7: number
    activeLast30: number
  }
  verification: {
    bootstrapped: number
    incomeVerified: number
    identityVerified: number
    bothVerified: number
    renterProfiles: number
  }
  connections: {
    requested: number
    accepted: number
    series: DayPoint[]
  }
  referrals: { code: string; label: string | null; useCount: number; attributed: number }[]
  money: {
    renterFeesCents: number
    renterFeeCount: number
    orgBillingCents: number
    activeSubscriptions: number
  }
  inventory: {
    orgs: number
    properties: number
    units: number
    byStatus: { status: string; count: number }[]
  }
  caveats: {
    usersWithoutProfile: number
    backfilledMarket: number
    verificationResetAt: string | null
  }
}

const zeroFilled = (days: number) => `
  SELECT generate_series(
    date_trunc('day', NOW()) - (($1::int - 1) * INTERVAL '1 day'),
    date_trunc('day', NOW()),
    INTERVAL '1 day'
  )::date AS day
`

export async function getOverview(days = 30): Promise<Overview> {
  const [
    signupTotals,
    signupSeries,
    byRole,
    byMarket,
    dau,
    activeCounts,
    verification,
    connections,
    connectionSeries,
    referrals,
    money,
    inventory,
    inventoryByStatus,
    caveats,
  ] = await Promise.all([
    // "user".createdAt is the ground truth for signups — more complete than any
    // profile table, because profile rows are created lazily (see caveats).
    db.query<{ total: string; last7: string; last30: string }>(`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days')::text  AS last7,
             COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days')::text AS last30
      FROM "user"`),

    db.query<{ day: string; count: string }>(`
      WITH d AS (${zeroFilled(days)})
      SELECT d.day::text, COUNT(u.id)::text AS count
      FROM d LEFT JOIN "user" u ON date_trunc('day', u."createdAt")::date = d.day
      GROUP BY d.day ORDER BY d.day`, [days]),

    db.query<{ role: string; count: string }>(`
      SELECT COALESCE(up.platform_role::text, u.role, 'unknown') AS role, COUNT(*)::text
      FROM "user" u LEFT JOIN user_profiles up ON up.user_id = u.id
      GROUP BY 1 ORDER BY 2 DESC`),

    db.query<{ market: string; count: string }>(`
      SELECT COALESCE(up.signup_market, 'unrecorded') AS market, COUNT(*)::text
      FROM "user" u LEFT JOIN user_profiles up ON up.user_id = u.id
      GROUP BY 1 ORDER BY 2 DESC`),

    // session.createdAt is real sign-in activity. Nothing in homey-ux has ever
    // queried this table for analytics — this is new ground, not a port.
    db.query<{ day: string; count: string }>(`
      WITH d AS (${zeroFilled(days)})
      SELECT d.day::text, COUNT(DISTINCT s."userId")::text AS count
      FROM d LEFT JOIN session s ON date_trunc('day', s."createdAt")::date = d.day
      GROUP BY d.day ORDER BY d.day`, [days]),

    db.query<{ last7: string; last30: string }>(`
      SELECT COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days')::text  AS last7,
             COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days')::text AS last30
      FROM session`),

    // "Who ran Plaid": income_verified_at is Plaid Income, identity_verified_at
    // is Plaid IDV. income_bootstrap_completed is the lighter pre-step that
    // only creates the Plaid user — not a report run.
    db.query<Record<string, string>>(`
      SELECT COUNT(*)::text AS renter_profiles,
             COUNT(*) FILTER (WHERE income_bootstrap_completed)::text AS bootstrapped,
             COUNT(*) FILTER (WHERE income_verified)::text            AS income_verified,
             COUNT(*) FILTER (WHERE identity_verified)::text          AS identity_verified,
             COUNT(*) FILTER (WHERE income_verified AND identity_verified)::text AS both_verified
      FROM renter_profiles`),

    db.query<{ requested: string; accepted: string }>(`
      SELECT (SELECT COUNT(*) FROM connection_requests)::text AS requested,
             (SELECT COUNT(*) FROM connections)::text         AS accepted`),

    db.query<{ day: string; count: string }>(`
      WITH d AS (${zeroFilled(days)})
      SELECT d.day::text, COUNT(c.id)::text AS count
      FROM d LEFT JOIN connection_requests c ON date_trunc('day', c.created_at)::date = d.day
      GROUP BY d.day ORDER BY d.day`, [days]),

    db.query<{ code: string; label: string | null; use_count: string; attributed: string }>(`
      SELECT rl.code, rl.label, rl.use_count::text,
             COUNT(rp.user_id)::text AS attributed
      FROM referral_links rl
      LEFT JOIN renter_profiles rp ON rp.referred_by_link_id = rl.id
      WHERE rl.revoked_at IS NULL
      GROUP BY rl.id, rl.code, rl.label, rl.use_count
      ORDER BY COUNT(rp.user_id) DESC, rl.code`),

    db.query<Record<string, string>>(`
      SELECT
        (SELECT COALESCE(SUM(amount_cents), 0) FROM renter_payments
           WHERE status = 'succeeded' AND refunded_at IS NULL)::text     AS renter_fees_cents,
        (SELECT COUNT(*) FROM renter_payments
           WHERE status = 'succeeded' AND refunded_at IS NULL)::text     AS renter_fee_count,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM client_billing_events)::text AS org_billing_cents,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'active')::text AS active_subscriptions`),

    db.query<Record<string, string>>(`
      SELECT (SELECT COUNT(*) FROM organizations WHERE deleted_at IS NULL)::text AS orgs,
             (SELECT COUNT(*) FROM properties    WHERE deleted_at IS NULL)::text AS properties,
             (SELECT COUNT(*) FROM units         WHERE deleted_at IS NULL)::text AS units`),

    db.query<{ status: string; count: string }>(`
      SELECT status::text, COUNT(*)::text FROM units
      WHERE deleted_at IS NULL GROUP BY status ORDER BY 2 DESC`),

    db.query<Record<string, string | null>>(`
      SELECT
        (SELECT COUNT(*) FROM "user" u
           WHERE NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id))::text
             AS users_without_profile,
        (SELECT COUNT(*) FROM user_profiles WHERE signup_market_backfilled)::text
             AS backfilled_market,
        (SELECT MAX(applied_at)::text FROM schema_migrations
           WHERE filename LIKE '0021%')
             AS verification_reset_at`),
  ])

  const n = (v: string | null | undefined) => Number(v ?? 0)
  const series = (rows: { day: string; count: string }[]): DayPoint[] =>
    rows.map((r) => ({ day: r.day, count: n(r.count) }))

  const v = verification.rows[0] ?? {}
  const m = money.rows[0] ?? {}
  const inv = inventory.rows[0] ?? {}
  const cav = caveats.rows[0] ?? {}
  const t = signupTotals.rows[0] ?? {}
  const a = activeCounts.rows[0] ?? {}
  const c = connections.rows[0] ?? {}

  return {
    signups: {
      total: n(t.total),
      last7: n(t.last7),
      last30: n(t.last30),
      series: series(signupSeries.rows),
      byRole: byRole.rows.map((r) => ({ role: r.role, count: n(r.count) })),
      byMarket: byMarket.rows.map((r) => ({ market: r.market, count: n(r.count) })),
    },
    activity: {
      dau: series(dau.rows),
      activeLast7: n(a.last7),
      activeLast30: n(a.last30),
    },
    verification: {
      renterProfiles: n(v.renter_profiles),
      bootstrapped: n(v.bootstrapped),
      incomeVerified: n(v.income_verified),
      identityVerified: n(v.identity_verified),
      bothVerified: n(v.both_verified),
    },
    connections: {
      requested: n(c.requested),
      accepted: n(c.accepted),
      series: series(connectionSeries.rows),
    },
    referrals: referrals.rows.map((r) => ({
      code: r.code,
      label: r.label,
      useCount: n(r.use_count),
      attributed: n(r.attributed),
    })),
    money: {
      renterFeesCents: n(m.renter_fees_cents),
      renterFeeCount: n(m.renter_fee_count),
      orgBillingCents: n(m.org_billing_cents),
      activeSubscriptions: n(m.active_subscriptions),
    },
    inventory: {
      orgs: n(inv.orgs),
      properties: n(inv.properties),
      units: n(inv.units),
      byStatus: inventoryByStatus.rows.map((r) => ({ status: r.status, count: n(r.count) })),
    },
    caveats: {
      usersWithoutProfile: n(cav.users_without_profile as string),
      backfilledMarket: n(cav.backfilled_market as string),
      verificationResetAt: (cav.verification_reset_at as string) ?? null,
    },
  }
}
