'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GapReport, HealthReport, HealthIssue, HealthRow } from '@/lib/gap-types'
import { ISSUE_COPY } from '@/lib/gap-types'
import { fmtPrice, bedsLabel, relTime } from '@/lib/format'
import { ChartCard, BarChart } from '../_chart'

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'gold' | 'green' }) {
  return (
    <div className="kpi-cell">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${tone ? ' ' + tone : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/**
 * Demand the platform cannot currently serve.
 *
 * The split that makes this actionable: a gap where you hold nothing at all is
 * an acquisition problem, while a gap where you hold units priced just above
 * what those renters can pay is a pricing conversation with a landlord you
 * already have. They call for completely different work, so they are labelled
 * differently rather than lumped into one "unmet demand" number.
 */
export function DemandTab({ gaps }: { gaps: GapReport }) {
  const acquisition = gaps.gaps.filter((g) => g.supplyInArea === 0)
  const pricing = gaps.gaps.filter((g) => g.supplyInArea > 0 && g.nearMisses > 0)

  const shortBy = (g: (typeof gaps.gaps)[number]) =>
    g.cheapestCents !== null && g.budgetHighCents !== null ? g.cheapestCents - g.budgetHighCents : null

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Renters With Preferences" value={gaps.totalWithPreferences} sub="told us what they want" />
        <Kpi label="Nothing To Show Them" value={gaps.unservedRenters}
          sub="zero matching live units" tone="gold" />
        <Kpi label="Acquisition Gaps" value={acquisition.length} sub="areas you hold nothing in" />
        <Kpi label="Pricing Gaps" value={pricing.length} sub="you have stock, priced over" />
      </div>

      <h2 className="section-heading">Where the demand is</h2>
      <p className="section-note">
        Neighborhoods renters asked for, ranked by how many of them have no live option there.
        A tall bar with low supply is where to go looking for inventory.
      </p>
      <div className="charts-grid" style={{ marginTop: 0 }}>
        <ChartCard title="Unserved Renters by Neighborhood" empty={!gaps.hotspots.length}
          emptyNote="No renter has set a neighborhood preference yet.">
          <BarChart horizontal labels={gaps.hotspots.map((h) => h.neighborhood)} data={gaps.hotspots.map((h) => h.unserved)} />
        </ChartCard>
        <ChartCard title="Live Units in Those Same Areas" empty={!gaps.hotspots.length}>
          <BarChart horizontal labels={gaps.hotspots.map((h) => h.neighborhood)} data={gaps.hotspots.map((h) => h.supply)} color="#60a5fa" />
        </ChartCard>
      </div>

      <h3 className="section-heading sm" style={{ marginTop: 28 }}>Go find these — you have nothing</h3>
      <p className="section-note">Renters want this exact combination and there is not a single live unit matching it.</p>
      <div className="table-wrap scroll-x">
        <table>
          <thead><tr><th>Neighborhood</th><th>Beds</th><th>Renters waiting</th><th>Their budget</th></tr></thead>
          <tbody>
            {acquisition.length === 0 && <tr><td colSpan={4} className="table-empty">Every stated preference has at least one matching unit.</td></tr>}
            {acquisition.map((g, i) => (
              <tr key={i}>
                <td className="td-primary">{g.neighborhood ?? 'Anywhere'}</td>
                <td>{g.bedrooms === null ? 'Any' : bedsLabel(g.bedrooms)}</td>
                <td><span className="badge badge-amber">{g.renters}</span></td>
                <td>up to {fmtPrice(g.budgetHighCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-heading sm" style={{ marginTop: 24 }}>Priced just out of reach</h3>
      <p className="section-note">
        You already hold stock here — it costs more than these renters can pay. The
        &ldquo;short by&rdquo; column is the distance between your cheapest matching unit and the
        most any of them can spend.
      </p>
      <div className="table-wrap scroll-x">
        <table>
          <thead><tr>
            <th>Neighborhood</th><th>Beds</th><th>Renters</th><th>Budget range</th>
            <th>Your cheapest</th><th>Short by</th><th>Units over</th>
          </tr></thead>
          <tbody>
            {pricing.length === 0 && <tr><td colSpan={7} className="table-empty">No pricing gaps.</td></tr>}
            {pricing.map((g, i) => {
              const s = shortBy(g)
              return (
                <tr key={i}>
                  <td className="td-primary">{g.neighborhood ?? 'Anywhere'}</td>
                  <td>{g.bedrooms === null ? 'Any' : bedsLabel(g.bedrooms)}</td>
                  <td>{g.renters}</td>
                  <td>{fmtPrice(g.budgetLowCents)} – {fmtPrice(g.budgetHighCents)}</td>
                  <td className="td-gold">{fmtPrice(g.cheapestCents)}</td>
                  <td>{s !== null && s > 0
                    ? <span className={`badge ${s < 30000 ? 'badge-amber' : 'badge-red'}`}>{fmtPrice(s)}</span>
                    : '--'}</td>
                  <td>{g.nearMisses}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 className="section-heading sm" style={{ marginTop: 24 }}>Searches that returned nothing</h3>
      <p className="section-note">
        The truer signal — what people actually looked for and did not find. Only records
        forward from 4 September 2026, so this fills in over time.
      </p>
      <div className="table-wrap scroll-x">
        <table>
          <thead><tr><th>Filters</th><th>Times</th><th>Last searched</th></tr></thead>
          <tbody>
            {gaps.zeroResults.length === 0 && <tr><td colSpan={3} className="table-empty">No zero-result searches recorded yet.</td></tr>}
            {gaps.zeroResults.map((z, i) => (
              <tr key={i}>
                <td className="td-primary">{describe(z.filters)}</td>
                <td><span className="badge badge-amber">{z.times}</span></td>
                <td>{relTime(z.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="caveat">
        Built from stated preferences, which {gaps.totalWithPreferences} of your renters have set —
        the rest never told us anything, so they cannot be counted as unserved either way. A renter
        wanting three neighborhoods counts once against each.
      </p>
    </>
  )
}

const SEVERITY_ORDER: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 }

/**
 * Why a live unit is getting no attention, and a way to fix it in place.
 * Every check maps to a concrete consequence, not a score for its own sake.
 */
export function HealthTab({ health, neighborhoods }: { health: HealthReport; neighborhoods: string[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<HealthIssue | ''>('')
  const [client, setClient] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const rows = useMemo(() => {
    let r = health.rows.filter((x) => x.issues.length > 0)
    if (filter) r = r.filter((x) => x.issues.includes(filter))
    if (client) r = r.filter((x) => x.orgId === client)
    return [...r].sort((a, b) => {
      const sa = Math.min(...a.issues.map((i) => SEVERITY_ORDER[ISSUE_COPY[i].severity]))
      const sb = Math.min(...b.issues.map((i) => SEVERITY_ORDER[ISSUE_COPY[i].severity]))
      return sa - sb || b.issues.length - a.issues.length
    })
  }, [health.rows, filter, client])

  async function fix(unitId: string, body: Record<string, unknown>, msg: string) {
    setBusy(unitId)
    try {
      const res = await fetch(`/api/units/${encodeURIComponent(unitId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setToast(j.error ?? `Failed (${res.status})`)
      } else {
        setToast(msg)
        router.refresh()
      }
    } catch { setToast('Network error — nothing changed') }
    finally {
      setBusy(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const worst = health.byClient.filter((c) => c.withIssues > 0).slice(0, 12)

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Live Units" value={health.totalActive} sub="status: vacant" />
        <Kpi label="Complete" value={health.cleanCount}
          sub={`${Math.round((health.cleanCount / Math.max(1, health.totalActive)) * 100)}% of live stock`} tone="green" />
        <Kpi label="Invisible To Search" value={health.counts.no_neighborhood} sub="no neighborhood set" tone="gold" />
        <Kpi label="No Price" value={health.counts.no_price} sub="skipped by budget filters" />
        <Kpi label="No Move-in Date" value={health.counts.no_available_date} sub="cannot match a timeline" />
      </div>

      <h2 className="section-heading">What is holding listings back</h2>
      <div className="filter-bar">
        <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value as HealthIssue | '')}>
          <option value="">All issues</option>
          {(Object.keys(ISSUE_COPY) as HealthIssue[]).map((k) => (
            <option key={k} value={k}>{ISSUE_COPY[k].label} ({health.counts[k]})</option>
          ))}
        </select>
        <select className="filter-select" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">All clients</option>
          {health.byClient.map((c) => <option key={c.orgId} value={c.orgId}>{c.clientName} ({c.withIssues})</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} units need attention</span>
      </div>

      {filter && (
        <p className="section-note" style={{ marginTop: -6 }}>
          <strong style={{ color: 'var(--text)' }}>{ISSUE_COPY[filter].label}:</strong> {ISSUE_COPY[filter].why}
        </p>
      )}

      <div className="table-wrap scroll-x">
        <table>
          <thead><tr>
            <th>Building</th><th>Unit</th><th>Client</th><th>Issues</th>
            <th>Days listed</th><th>Views</th><th>Fix</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="table-empty">Nothing matching that filter.</td></tr>}
            {rows.slice(0, 200).map((r) => (
              <tr key={r.unitId} style={{ opacity: busy === r.unitId ? .5 : 1 }}>
                <td className="td-primary">{r.address}</td>
                <td>{r.unit}</td>
                <td>{r.clientName}</td>
                <td>
                  {r.issues.map((i) => (
                    <span key={i} title={ISSUE_COPY[i].why}
                      className={`badge ${ISSUE_COPY[i].severity === 'high' ? 'badge-red' : ISSUE_COPY[i].severity === 'medium' ? 'badge-amber' : 'badge-muted'}`}
                      style={{ marginRight: 4 }}>
                      {ISSUE_COPY[i].label}
                    </span>
                  ))}
                </td>
                <td>{r.daysListed}</td>
                <td>{r.views}</td>
                <td><InlineFix row={r} neighborhoods={neighborhoods} busy={busy === r.unitId} onFix={fix} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && (
        <p className="section-note" style={{ marginTop: 8 }}>Showing the 200 most severe of {rows.length}.</p>
      )}

      <h3 className="section-heading sm" style={{ marginTop: 28 }}>By client</h3>
      <p className="section-note">Who to talk to. Excludes &ldquo;no views&rdquo; — view tracking is too new for that to mean anything yet.</p>
      <div className="table-wrap scroll-x">
        <table>
          <thead><tr><th>Client</th><th>Live units</th><th>Needing attention</th><th>Share</th></tr></thead>
          <tbody>
            {worst.length === 0 && <tr><td colSpan={4} className="table-empty">Every client&apos;s listings are complete.</td></tr>}
            {worst.map((c) => (
              <tr key={c.orgId}>
                <td className="td-primary">{c.clientName}</td>
                <td>{c.units}</td>
                <td>{c.withIssues}</td>
                <td>
                  <span className={`badge ${c.withIssues / c.units > .5 ? 'badge-red' : 'badge-amber'}`}>
                    {Math.round((c.withIssues / c.units) * 100)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="caveat">
        Days-listed is unreliable for migrated units: the retired Google-Sheets sync deleted and
        re-inserted every row on each edit, so their creation date reflects the last sync, not when
        the unit first went on the market.
      </p>

      {toast && <div className="toast-container"><div className="toast">{toast}</div></div>}
    </>
  )
}

function InlineFix({ row, neighborhoods, busy, onFix }: {
  row: HealthRow; neighborhoods: string[]; busy: boolean
  onFix: (id: string, body: Record<string, unknown>, msg: string) => void
}) {
  const [price, setPrice] = useState('')
  const [date, setDate] = useState('')

  if (row.issues.includes('no_neighborhood')) {
    return (
      <select className="status-select" disabled={busy} defaultValue=""
        onChange={(e) => e.target.value && onFix(row.unitId, { neighborhood: e.target.value }, `Neighborhood set — now visible in search`)}>
        <option value="">Set neighborhood…</option>
        {neighborhoods.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    )
  }
  if (row.issues.includes('no_price')) {
    return (
      <span style={{ display: 'flex', gap: 4 }}>
        <input className="status-select" style={{ width: 80 }} type="number" min={0} placeholder="$/mo"
          value={price} onChange={(e) => setPrice(e.target.value)} disabled={busy} />
        <button className="btn-icon" title="Save price" disabled={busy || !price}
          onClick={() => onFix(row.unitId, { rentDollars: Number(price) }, 'Price set')}>&#10003;</button>
      </span>
    )
  }
  if (row.issues.includes('no_available_date')) {
    return (
      <span style={{ display: 'flex', gap: 4 }}>
        <input className="status-select" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        <button className="btn-icon" title="Save date" disabled={busy || !date}
          onClick={() => onFix(row.unitId, { availableFrom: date }, 'Availability set')}>&#10003;</button>
      </span>
    )
  }
  return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
}

function describe(f: Record<string, unknown>): string {
  const p: string[] = []
  if (typeof f.beds === 'number') p.push(f.beds === 0 ? 'Studio' : `${f.beds}BR`)
  if (typeof f.maxRent === 'number') p.push(`under $${f.maxRent.toLocaleString()}`)
  if (Array.isArray(f.neighborhoods) && f.neighborhoods.length) p.push((f.neighborhoods as string[]).join(', '))
  if (f.hasQuery === true) p.push('+ text search')
  return p.length ? p.join(' · ') : 'no filters'
}
