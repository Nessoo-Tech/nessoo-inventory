import 'server-only'
import { db } from '../db'
import type { GapReport, GapRow, HealthIssue, HealthReport, HealthRow } from '../gap-types'

export type { GapReport, GapRow, HealthIssue, HealthReport, HealthRow } from '../gap-types'
export { ISSUE_COPY } from '../gap-types'

// Where demand exists and inventory does not.
//
// Two independent demand signals, deliberately:
//
//   Stated preferences — what renters told us they want. Available for 141
//   renters right now, so this produces a usable answer immediately rather than
//   waiting for logs to fill.
//
//   Zero-result searches — what people actually looked for and did not find.
//   Truer signal, but only records forward from 4 September 2026.
//
// A renter counts as unserved when ZERO active units match all of their stated
// constraints. That is a deliberately strict definition: it means the platform
// currently has literally nothing to show them.




const n = (v: unknown) => Number(v ?? 0)

export async function getGapReport(): Promise<GapReport> {
  const [summary, gaps, hotspots, zeros] = await Promise.all([
    db.query(`
      WITH demand AS (
        SELECT user_id, preferred_bedrooms AS beds, preferred_max_rent AS budget,
               CASE WHEN jsonb_typeof(preferred_neighborhoods) = 'array'
                    THEN preferred_neighborhoods ELSE '[]'::jsonb END AS nbhds
        FROM renter_profiles
        WHERE preferred_bedrooms IS NOT NULL OR preferred_max_rent IS NOT NULL
           OR jsonb_typeof(preferred_neighborhoods) = 'array'
      )
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active'
                 AND (d.beds   IS NULL OR u.bedrooms = d.beds)
                 AND (d.budget IS NULL OR (u.rent_cents IS NOT NULL AND u.rent_cents <= d.budget))
                 AND (jsonb_array_length(d.nbhds) = 0
                      OR d.nbhds ? (u.other_criteria->>'neighborhood'))
             ))::int AS unserved
      FROM demand d`),

    // One row per distinct thing an unserved renter is asking for.
    db.query(`
      WITH demand AS (
        SELECT rp.user_id, rp.preferred_bedrooms AS beds, rp.preferred_max_rent AS budget,
               CASE WHEN jsonb_typeof(rp.preferred_neighborhoods) = 'array'
                    THEN rp.preferred_neighborhoods ELSE '[]'::jsonb END AS nbhds
        FROM renter_profiles rp
        WHERE rp.preferred_bedrooms IS NOT NULL OR rp.preferred_max_rent IS NOT NULL
           OR jsonb_typeof(rp.preferred_neighborhoods) = 'array'
      ),
      unserved AS (
        SELECT * FROM demand d
        WHERE NOT EXISTS (
          SELECT 1 FROM units u
          WHERE u.deleted_at IS NULL AND u.status = 'active'
            AND (d.beds   IS NULL OR u.bedrooms = d.beds)
            AND (d.budget IS NULL OR (u.rent_cents IS NOT NULL AND u.rent_cents <= d.budget))
            AND (jsonb_array_length(d.nbhds) = 0
                 OR d.nbhds ? (u.other_criteria->>'neighborhood'))
        )
      ),
      -- Flatten to one row per (renter, wanted neighborhood) so a renter asking
      -- for three areas is counted once against each.
      wants AS (
        SELECT u.user_id, u.beds, u.budget,
               NULLIF(jsonb_array_elements_text(u.nbhds), '') AS nbhd
          FROM unserved u WHERE jsonb_array_length(u.nbhds) > 0
        UNION ALL
        SELECT u.user_id, u.beds, u.budget, NULL
          FROM unserved u WHERE jsonb_array_length(u.nbhds) = 0
      ),
      grouped AS (
        SELECT w.nbhd, w.beds,
               COUNT(DISTINCT w.user_id)::int AS renters,
               MIN(w.budget)::int AS budget_low,
               MAX(w.budget)::int AS budget_high
        FROM wants w GROUP BY w.nbhd, w.beds
      )
      -- Reported against the group's HIGHEST budget: that is the closest any of
      -- these renters can get. Using the lowest (as a bare MIN would) makes
      -- "priced above budget" trivially true and tells you nothing.
      SELECT g.nbhd, g.beds, g.renters, g.budget_low, g.budget_high,
             (SELECT COUNT(*) FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active'
                 AND (g.nbhd IS NULL OR u.other_criteria->>'neighborhood' = g.nbhd)
                 AND (g.beds IS NULL OR u.bedrooms = g.beds))::int AS supply_in_area,
             (SELECT COUNT(*) FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active'
                 AND (g.nbhd IS NULL OR u.other_criteria->>'neighborhood' = g.nbhd)
                 AND (g.beds IS NULL OR u.bedrooms = g.beds)
                 AND u.rent_cents > g.budget_high)::int AS near_misses,
             (SELECT MIN(u.rent_cents) FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active' AND u.rent_cents > 0
                 AND (g.nbhd IS NULL OR u.other_criteria->>'neighborhood' = g.nbhd)
                 AND (g.beds IS NULL OR u.bedrooms = g.beds))::int AS cheapest
      FROM grouped g
      ORDER BY g.renters DESC, near_misses DESC
      LIMIT 40`),

    db.query(`
      WITH demand AS (
        SELECT rp.user_id, rp.preferred_bedrooms AS beds, rp.preferred_max_rent AS budget,
               CASE WHEN jsonb_typeof(rp.preferred_neighborhoods) = 'array'
                    THEN rp.preferred_neighborhoods ELSE '[]'::jsonb END AS nbhds
        FROM renter_profiles rp
        WHERE jsonb_typeof(rp.preferred_neighborhoods) = 'array'
          AND jsonb_array_length(rp.preferred_neighborhoods) > 0
      )
      SELECT nb AS neighborhood,
             COUNT(DISTINCT d.user_id) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active'
                 AND u.other_criteria->>'neighborhood' = nb
                 AND (d.beds   IS NULL OR u.bedrooms = d.beds)
                 AND (d.budget IS NULL OR (u.rent_cents IS NOT NULL AND u.rent_cents <= d.budget))
             ))::int AS unserved,
             (SELECT COUNT(*) FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active'
                 AND u.other_criteria->>'neighborhood' = nb)::int AS supply
      FROM demand d, LATERAL jsonb_array_elements_text(d.nbhds) AS nb
      GROUP BY nb
      HAVING COUNT(DISTINCT d.user_id) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM units u
               WHERE u.deleted_at IS NULL AND u.status = 'active'
                 AND u.other_criteria->>'neighborhood' = nb
                 AND (d.beds   IS NULL OR u.bedrooms = d.beds)
                 AND (d.budget IS NULL OR (u.rent_cents IS NOT NULL AND u.rent_cents <= d.budget))
             )) > 0
      ORDER BY unserved DESC LIMIT 15`),

    db.query(`
      SELECT filters, COUNT(*)::int AS times, MAX(created_at) AS last_at
      FROM search_events WHERE result_count = 0
      GROUP BY filters ORDER BY times DESC, last_at DESC LIMIT 20`),
  ])

  const s = summary.rows[0] ?? {}
  return {
    totalWithPreferences: n(s.total),
    unservedRenters: n(s.unserved),
    gaps: gaps.rows.map((r) => ({
      neighborhood: r.nbhd,
      bedrooms: r.beds === null ? null : n(r.beds),
      budgetLowCents: r.budget_low === null ? null : n(r.budget_low),
      budgetHighCents: r.budget_high === null ? null : n(r.budget_high),
      cheapestCents: r.cheapest === null ? null : n(r.cheapest),
      renters: n(r.renters),
      nearMisses: n(r.near_misses),
      supplyInArea: n(r.supply_in_area),
    })),
    hotspots: hotspots.rows.map((r) => ({
      neighborhood: r.neighborhood, unserved: n(r.unserved), supply: n(r.supply),
    })),
    zeroResults: zeros.rows.map((r) => ({
      filters: r.filters ?? {}, times: n(r.times), lastAt: new Date(r.last_at).toISOString(),
    })),
  }
}

// ── listing health ────────────────────────────────────────────────────────
//
// Why a unit gets no attention. Every check below is a concrete, fixable reason
// — not a score for its own sake. 99 active units currently have no
// neighborhood, which makes them invisible to neighborhood search entirely.




export async function getHealthReport(): Promise<HealthReport> {
  const { rows } = await db.query(`
    SELECT u.id, u.org_id, o.name AS client_name, p.address, u.name AS unit,
           u.other_criteria->>'neighborhood' AS nbhd, u.rent_cents, u.bedrooms, u.available_from,
           (EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 86400)::int AS days_listed,
           (SELECT COUNT(*) FROM listing_view_events v WHERE v.unit_id = u.id)::int AS views,
           (SELECT COUNT(*) FROM connection_requests cr WHERE cr.unit_id = u.id)::int AS requests
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN organizations o ON o.id = u.org_id
    WHERE u.deleted_at IS NULL AND u.status = 'active'
    ORDER BY o.name, p.address, u.name`)

  const counts: Record<HealthIssue, number> = {
    no_neighborhood: 0, no_price: 0, no_available_date: 0, no_bedrooms: 0, stale: 0, no_interest: 0,
  }
  const byClient = new Map<string, { orgId: string; clientName: string; units: number; withIssues: number }>()

  const out: HealthRow[] = rows.map((r) => {
    const issues: HealthIssue[] = []
    if (!r.nbhd) issues.push('no_neighborhood')
    if (r.rent_cents === null || r.rent_cents === 0) issues.push('no_price')
    if (r.bedrooms === null) issues.push('no_bedrooms')
    if (!r.available_from) issues.push('no_available_date')
    if (n(r.days_listed) >= 60) issues.push('stale')
    if (n(r.views) === 0 && n(r.requests) === 0) issues.push('no_interest')
    for (const i of issues) counts[i]++

    const c = byClient.get(r.org_id) ?? { orgId: r.org_id, clientName: r.client_name, units: 0, withIssues: 0 }
    c.units++
    // "With issues" ignores no_interest — it is a symptom, and with view tracking
    // one day old it would otherwise flag nearly everything and mean nothing.
    if (issues.some((i) => i !== 'no_interest')) c.withIssues++
    byClient.set(r.org_id, c)

    return {
      unitId: r.id, orgId: r.org_id, clientName: r.client_name, address: r.address, unit: r.unit,
      neighborhood: r.nbhd, rentCents: r.rent_cents === null ? null : n(r.rent_cents),
      bedrooms: r.bedrooms === null ? null : n(r.bedrooms),
      availableFrom: r.available_from ? new Date(r.available_from).toISOString().slice(0, 10) : null,
      daysListed: n(r.days_listed), views: n(r.views), requests: n(r.requests), issues,
    }
  })

  return {
    rows: out,
    counts,
    totalActive: out.length,
    cleanCount: out.filter((r) => r.issues.filter((i) => i !== 'no_interest').length === 0).length,
    byClient: [...byClient.values()].sort((a, b) => b.withIssues - a.withIssues),
  }
}
