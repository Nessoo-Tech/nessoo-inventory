import 'server-only'
import { db } from '../db'

// Everything the eight admin tabs render. The originals ran on hand-written mock
// data; each field here maps to a real query, and where the platform genuinely
// does not record something the field is null and the UI says so rather than
// inventing a number.

export interface DayPoint { day: string; count: number }
export interface ActivityEvent {
  type: 'signup' | 'connect' | 'view' | 'apply' | 'verify'
  user: string
  detail: string
  at: string
}
export interface SearchRow {
  user: string | null
  filters: Record<string, unknown>
  results: number
  surface: string | null
  at: string
}
export interface ListingPerf {
  unitId: string
  address: string
  unit: string
  neighborhood: string | null
  rentCents: number | null
  views: number
  connections: number
  daysListed: number | null
}

export interface AdminData {
  activity: { events: ActivityEvent[]; signupsToday: number; connectionsToday: number; viewsToday: number; eventsToday: number }
  analytics: {
    totalSignups: number
    monthlyGrowthPct: number | null
    retention7dPct: number | null
    avgSessionMins: null            // not measured — no session-duration data exists
    signupsByDay: DayPoint[]
    dauByDay: DayPoint[]
    funnel: { visited: number | null; signedUp: number; completedProfile: number; firstConnection: number }
    topNeighborhoods: [string, number][]
    budgetDist: [string, number][]
    prefBeds: [string, number][]
  }
  searches: {
    total: number
    today: number
    noResultsRatePct: number | null
    topSearch: string | null
    byNeighborhood: [string, number][]
    byBeds: [string, number][]
    recent: SearchRow[]
    unmet: { label: string; frequency: number; lastAt: string }[]
  }
  listings: {
    top: ListingPerf[]
    dead: ListingPerf[]
    noActivityCount: number
    avgHoursToConnect: number | null
    totalViews: number
  }
  system: {
    dbSize: string
    tableCount: number
    slowestTables: { name: string; rows: number }[]
    migrationsApplied: number
    lastMigration: { filename: string; at: string } | null
    apiCalls24h: number
    apiErrors24h: number
    avgLatencyMs: number | null
  }
  revenue: {
    renterFeesCents: number
    renterFeeCount: number
    orgBillingCents: number
    activeSubscriptions: number
    monthCents: number
    byMonth: { month: string; cents: number }[]
    bySource: [string, number][]
    aiSpendMicros: number
  }
}

const num = (v: unknown) => Number(v ?? 0)
const series = (rows: { day: string; count: string }[]): DayPoint[] =>
  rows.map((r) => ({ day: r.day, count: num(r.count) }))

const zeroFilled = `
  SELECT generate_series(
    date_trunc('day', NOW()) - (($1::int - 1) * INTERVAL '1 day'),
    date_trunc('day', NOW()), INTERVAL '1 day')::date AS day`

export async function getAdminData(days = 14): Promise<AdminData> {
  const [
    activityRows, todayCounts, signupSeries, dauSeries, growth, funnel,
    prefsNeighborhood, prefsBudget, prefsBeds,
    searchTotals, searchRecent, searchUnmet, searchNhoods, searchBeds,
    listingTop, listingDead, listingAgg,
    sysSize, sysTables, sysMigrations, sysApi,
    money, moneyMonths, aiSpend,
  ] = await Promise.all([
    // ── activity: one union of the real things that happen on the platform ──
    db.query(`
      (SELECT 'signup' AS type, COALESCE(u.name, u.email) AS who,
              'Created an account' AS detail, u."createdAt" AS at
         FROM "user" u ORDER BY u."createdAt" DESC LIMIT 40)
      UNION ALL
      (SELECT 'connect', COALESCE(ru.name, ru.email),
              'Connected with ' || COALESCE(p.address, 'a listing') || ' ' || COALESCE(un.name, ''),
              c.accepted_at
         FROM connections c
         LEFT JOIN "user" ru ON ru.id = c.renter_id
         LEFT JOIN units un ON un.id = c.unit_id
         LEFT JOIN properties p ON p.id = un.property_id
        WHERE c.accepted_at IS NOT NULL ORDER BY c.accepted_at DESC LIMIT 40)
      UNION ALL
      (SELECT 'apply', COALESCE(ru.name, ru.email),
              'Requested ' || COALESCE(p.address, 'a listing') || ' ' || COALESCE(un.name, ''),
              cr.created_at
         FROM connection_requests cr
         LEFT JOIN "user" ru ON ru.id = cr.renter_id
         LEFT JOIN units un ON un.id = cr.unit_id
         LEFT JOIN properties p ON p.id = un.property_id
        ORDER BY cr.created_at DESC LIMIT 40)
      UNION ALL
      (SELECT 'view', COALESCE(vu.name, vu.email, 'Anonymous visitor'),
              'Viewed ' || COALESCE(p.address, 'a listing') || ' ' || COALESCE(un.name, ''),
              lv.created_at
         FROM listing_view_events lv
         LEFT JOIN "user" vu ON vu.id = lv.viewer_id
         LEFT JOIN units un ON un.id = lv.unit_id
         LEFT JOIN properties p ON p.id = un.property_id
        ORDER BY lv.created_at DESC LIMIT 40)
      UNION ALL
      (SELECT 'verify', COALESCE(vu.name, vu.email),
              'Completed income verification', rp.income_verified_at
         FROM renter_profiles rp LEFT JOIN "user" vu ON vu.id = rp.user_id
        WHERE rp.income_verified_at IS NOT NULL ORDER BY rp.income_verified_at DESC LIMIT 20)
      ORDER BY at DESC LIMIT 60`),

    db.query(`
      SELECT (SELECT COUNT(*) FROM "user" WHERE "createdAt" >= date_trunc('day', NOW()))::int AS signups,
             (SELECT COUNT(*) FROM connections WHERE accepted_at >= date_trunc('day', NOW()))::int AS connects,
             (SELECT COUNT(*) FROM listing_view_events WHERE created_at >= date_trunc('day', NOW()))::int AS views,
             (SELECT COUNT(*) FROM connection_requests WHERE created_at >= date_trunc('day', NOW()))::int AS requests`),

    db.query(`WITH d AS (${zeroFilled})
      SELECT d.day::text, COUNT(u.id)::text AS count FROM d
      LEFT JOIN "user" u ON date_trunc('day', u."createdAt")::date = d.day
      GROUP BY d.day ORDER BY d.day`, [days]),

    db.query(`WITH d AS (${zeroFilled})
      SELECT d.day::text, COUNT(DISTINCT s."userId")::text AS count FROM d
      LEFT JOIN session s ON date_trunc('day', s."createdAt")::date = d.day
      GROUP BY d.day ORDER BY d.day`, [days]),

    db.query(`
      SELECT COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int AS this_month,
             COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '1 month')
                                AND "createdAt" <  date_trunc('month', NOW()))::int AS last_month,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "createdAt" < NOW() - INTERVAL '7 days')::int AS cohort,
             COUNT(*) FILTER (WHERE "createdAt" < NOW() - INTERVAL '7 days' AND EXISTS (
               SELECT 1 FROM session s WHERE s."userId" = "user".id
                 AND s."createdAt" > "user"."createdAt" + INTERVAL '1 day'
                 AND s."createdAt" <= "user"."createdAt" + INTERVAL '7 days'))::int AS retained
      FROM "user"`),

    db.query(`
      SELECT (SELECT COUNT(*) FROM "user")::int AS signed_up,
             (SELECT COUNT(*) FROM renter_profiles
               WHERE preferred_city IS NOT NULL OR preferred_bedrooms IS NOT NULL
                  OR preferred_max_rent IS NOT NULL)::int AS completed_profile,
             (SELECT COUNT(DISTINCT renter_id) FROM connections)::int AS first_connection`),

    // preferred_neighborhoods is JSONB (an array of strings), not text[] — so
    // this needs jsonb_array_elements_text, not unnest. Renters who set only a
    // city fall back to that, so they are not silently dropped from the tally.
    db.query(`
      SELECT n AS label, COUNT(*)::int AS c FROM (
        SELECT jsonb_array_elements_text(rp.preferred_neighborhoods) AS n
          FROM renter_profiles rp
         WHERE jsonb_typeof(rp.preferred_neighborhoods) = 'array'
        UNION ALL
        SELECT rp.preferred_city
          FROM renter_profiles rp
         WHERE rp.preferred_city IS NOT NULL
           AND (jsonb_typeof(rp.preferred_neighborhoods) IS DISTINCT FROM 'array'
                OR jsonb_array_length(rp.preferred_neighborhoods) = 0)
      ) q
      WHERE n IS NOT NULL AND n <> '' GROUP BY n ORDER BY c DESC LIMIT 8`),

    db.query(`
      SELECT CASE
               WHEN preferred_max_rent IS NULL THEN NULL
               WHEN preferred_max_rent < 150000 THEN '$1-1.5k'
               WHEN preferred_max_rent < 200000 THEN '$1.5-2k'
               WHEN preferred_max_rent < 250000 THEN '$2-2.5k'
               WHEN preferred_max_rent < 300000 THEN '$2.5-3k'
               WHEN preferred_max_rent < 400000 THEN '$3-4k'
               WHEN preferred_max_rent < 500000 THEN '$4-5k'
               ELSE '$5k+' END AS label,
             COUNT(*)::int AS c
      FROM renter_profiles WHERE preferred_max_rent IS NOT NULL
      GROUP BY 1 ORDER BY MIN(preferred_max_rent)`),

    db.query(`
      SELECT CASE WHEN preferred_bedrooms = 0 THEN 'Studio'
                  WHEN preferred_bedrooms >= 4 THEN '4BR+'
                  ELSE preferred_bedrooms || 'BR' END AS label,
             COUNT(*)::int AS c
      FROM renter_profiles WHERE preferred_bedrooms IS NOT NULL
      GROUP BY 1, preferred_bedrooms ORDER BY MIN(preferred_bedrooms)`),

    // ── search demand ──
    db.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS today,
             COUNT(*) FILTER (WHERE result_count = 0)::int AS zero
      FROM search_events WHERE created_at > NOW() - INTERVAL '30 days'`),

    db.query(`
      SELECT COALESCE(u.name, u.email) AS who, se.filters, se.result_count, se.surface, se.created_at
      FROM search_events se LEFT JOIN "user" u ON u.id = se.user_id
      ORDER BY se.created_at DESC LIMIT 25`),

    db.query(`
      SELECT filters::text AS label, COUNT(*)::int AS freq, MAX(created_at) AS last_at
      FROM search_events WHERE result_count = 0
      GROUP BY filters::text ORDER BY freq DESC LIMIT 10`),

    db.query(`
      SELECT n AS label, COUNT(*)::int AS c
      FROM search_events se, LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(se.filters->'neighborhoods') = 'array'
             THEN se.filters->'neighborhoods' ELSE '[]'::jsonb END) AS n
      GROUP BY n ORDER BY c DESC LIMIT 8`),

    db.query(`
      SELECT CASE WHEN (filters->>'beds')::int = 0 THEN 'Studio'
                  WHEN (filters->>'beds')::int >= 4 THEN '4BR+'
                  ELSE (filters->>'beds') || 'BR' END AS label,
             COUNT(*)::int AS c
      FROM search_events WHERE filters->>'beds' IS NOT NULL
      GROUP BY 1, (filters->>'beds')::int ORDER BY MIN((filters->>'beds')::int)`),

    // ── listing performance ──
    db.query(`
      SELECT u.id, p.address, u.name AS unit, u.other_criteria->>'neighborhood' AS nb, u.rent_cents,
             (SELECT COUNT(*) FROM listing_view_events v WHERE v.unit_id = u.id)::int AS views,
             (SELECT COUNT(*) FROM connection_requests cr WHERE cr.unit_id = u.id)::int AS conns,
             EXTRACT(DAY FROM NOW() - u.created_at)::int AS days_listed
      FROM units u JOIN properties p ON p.id = u.property_id
      WHERE u.deleted_at IS NULL
      ORDER BY views DESC, conns DESC LIMIT 10`),

    db.query(`
      SELECT u.id, p.address, u.name AS unit, u.other_criteria->>'neighborhood' AS nb, u.rent_cents,
             0 AS views, 0 AS conns,
             EXTRACT(DAY FROM NOW() - u.created_at)::int AS days_listed
      FROM units u JOIN properties p ON p.id = u.property_id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM listing_view_events v WHERE v.unit_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM connection_requests cr WHERE cr.unit_id = u.id)
      ORDER BY u.created_at ASC LIMIT 10`),

    db.query(`
      SELECT (SELECT COUNT(*) FROM listing_view_events)::int AS total_views,
             (SELECT COUNT(*) FROM units u WHERE u.deleted_at IS NULL AND u.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM listing_view_events v WHERE v.unit_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM connection_requests cr WHERE cr.unit_id = u.id))::int AS dead,
             (SELECT AVG(EXTRACT(EPOCH FROM (cr.created_at - u.created_at)) / 3600)
                FROM connection_requests cr JOIN units u ON u.id = cr.unit_id
               WHERE cr.created_at > u.created_at) AS avg_hours`),

    // ── system ──
    db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
    db.query(`
      SELECT relname AS name, n_live_tup::int AS rows FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC LIMIT 6`),
    db.query(`
      SELECT COUNT(*)::int AS applied,
             (SELECT filename FROM schema_migrations ORDER BY applied_at DESC LIMIT 1) AS last_file,
             (SELECT applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1) AS last_at
      FROM schema_migrations`),
    db.query(`
      SELECT COUNT(*)::int AS calls,
             COUNT(*) FILTER (WHERE NOT ok)::int AS errors,
             AVG(latency_ms) AS avg_latency
      FROM api_usage_events WHERE created_at > NOW() - INTERVAL '24 hours'`),

    // ── revenue ──
    db.query(`
      SELECT (SELECT COALESCE(SUM(amount_cents),0) FROM renter_payments
                WHERE status = 'succeeded' AND refunded_at IS NULL)::bigint AS renter_fees,
             (SELECT COUNT(*) FROM renter_payments
                WHERE status = 'succeeded' AND refunded_at IS NULL)::int AS renter_count,
             (SELECT COALESCE(SUM(amount_cents),0) FROM client_billing_events)::bigint AS org_billing,
             (SELECT COUNT(*) FROM subscriptions WHERE status = 'active')::int AS subs,
             (SELECT COALESCE(SUM(amount_cents),0) FROM renter_payments
                WHERE status = 'succeeded' AND refunded_at IS NULL
                  AND paid_at >= date_trunc('month', NOW()))::bigint AS month_cents`),
    db.query(`
      SELECT to_char(m, 'Mon') AS month, COALESCE(SUM(rp.amount_cents), 0)::bigint AS cents
      FROM generate_series(date_trunc('month', NOW()) - INTERVAL '8 months',
                           date_trunc('month', NOW()), INTERVAL '1 month') AS m
      LEFT JOIN renter_payments rp ON date_trunc('month', rp.paid_at) = m
        AND rp.status = 'succeeded' AND rp.refunded_at IS NULL
      GROUP BY m ORDER BY m`),
    db.query(`SELECT COALESCE(SUM(cost_micros), 0)::bigint AS micros FROM api_usage_events`),
  ])

  const g = growth.rows[0] ?? {}
  const t = todayCounts.rows[0] ?? {}
  const st = searchTotals.rows[0] ?? {}
  const la = listingAgg.rows[0] ?? {}
  const m = money.rows[0] ?? {}
  const sm = sysMigrations.rows[0] ?? {}
  const sa = sysApi.rows[0] ?? {}
  const f = funnel.rows[0] ?? {}

  const perf = (r: Record<string, unknown>): ListingPerf => ({
    unitId: String(r.id), address: String(r.address ?? ''), unit: String(r.unit ?? ''),
    neighborhood: (r.nb as string) ?? null, rentCents: r.rent_cents === null ? null : num(r.rent_cents),
    views: num(r.views), connections: num(r.conns), daysListed: r.days_listed === null ? null : num(r.days_listed),
  })

  const lastMonth = num(g.last_month)
  const pair = (rows: { label: string; c: number }[]): [string, number][] =>
    rows.filter((r) => r.label).map((r) => [r.label, num(r.c)])

  return {
    activity: {
      events: activityRows.rows.map((r) => ({
        type: r.type, user: r.who ?? 'Unknown', detail: String(r.detail ?? '').trim(),
        at: new Date(r.at).toISOString(),
      })),
      signupsToday: num(t.signups),
      connectionsToday: num(t.connects),
      viewsToday: num(t.views),
      eventsToday: num(t.signups) + num(t.connects) + num(t.views) + num(t.requests),
    },
    analytics: {
      totalSignups: num(g.total),
      monthlyGrowthPct: lastMonth > 0 ? Math.round(((num(g.this_month) - lastMonth) / lastMonth) * 100) : null,
      retention7dPct: num(g.cohort) > 0 ? Math.round((num(g.retained) / num(g.cohort)) * 100) : null,
      avgSessionMins: null,
      signupsByDay: series(signupSeries.rows),
      dauByDay: series(dauSeries.rows),
      funnel: {
        // Top-of-funnel pageviews live in GA4, not this database.
        visited: null,
        signedUp: num(f.signed_up),
        completedProfile: num(f.completed_profile),
        firstConnection: num(f.first_connection),
      },
      topNeighborhoods: pair(prefsNeighborhood.rows),
      budgetDist: pair(prefsBudget.rows),
      prefBeds: pair(prefsBeds.rows),
    },
    searches: {
      total: num(st.total),
      today: num(st.today),
      noResultsRatePct: num(st.total) > 0 ? Math.round((num(st.zero) / num(st.total)) * 100) : null,
      topSearch: searchNhoods.rows[0]?.label ?? null,
      byNeighborhood: pair(searchNhoods.rows),
      byBeds: pair(searchBeds.rows),
      recent: searchRecent.rows.map((r) => ({
        user: r.who, filters: r.filters ?? {}, results: num(r.result_count),
        surface: r.surface, at: new Date(r.created_at).toISOString(),
      })),
      unmet: searchUnmet.rows.map((r) => ({
        label: r.label, frequency: num(r.freq), lastAt: new Date(r.last_at).toISOString(),
      })),
    },
    listings: {
      top: listingTop.rows.map(perf).filter((r) => r.views > 0 || r.connections > 0),
      dead: listingDead.rows.map(perf),
      noActivityCount: num(la.dead),
      avgHoursToConnect: la.avg_hours === null ? null : Math.round(Number(la.avg_hours)),
      totalViews: num(la.total_views),
    },
    system: {
      dbSize: sysSize.rows[0]?.size ?? '--',
      tableCount: sysTables.rows.length,
      slowestTables: sysTables.rows.map((r) => ({ name: r.name, rows: num(r.rows) })),
      migrationsApplied: num(sm.applied),
      lastMigration: sm.last_file ? { filename: sm.last_file, at: new Date(sm.last_at).toISOString() } : null,
      apiCalls24h: num(sa.calls),
      apiErrors24h: num(sa.errors),
      avgLatencyMs: sa.avg_latency === null ? null : Math.round(Number(sa.avg_latency)),
    },
    revenue: {
      renterFeesCents: num(m.renter_fees),
      renterFeeCount: num(m.renter_count),
      orgBillingCents: num(m.org_billing),
      activeSubscriptions: num(m.subs),
      monthCents: num(m.month_cents),
      byMonth: moneyMonths.rows.map((r) => ({ month: r.month, cents: num(r.cents) })),
      bySource: [
        ['Renter fees', num(m.renter_fees)],
        ['Client billing', num(m.org_billing)],
      ].filter(([, v]) => (v as number) > 0) as [string, number][],
      aiSpendMicros: num(aiSpend.rows[0]?.micros),
    },
  }
}
