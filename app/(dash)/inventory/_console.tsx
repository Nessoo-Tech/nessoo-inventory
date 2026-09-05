'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { InventoryData, ListingRow, ProspectRow } from '@/lib/queries/inventory-data'
import { fmtPrice, fmtDate, bedsLabel, CHART_COLORS } from '@/lib/format'
import { ChartCard, BarChart, DoughnutChart } from '../_chart'
import { runSearch, describeParsed, type SearchFilters } from './_search'
import { NHOODS } from './_search'
import { DemandTab, HealthTab } from './_demand-health'
import type { GapReport, HealthReport } from '@/lib/gap-types'

type Tab = 'inventory' | 'search' | 'demand' | 'health' | 'leased' | 'renters' | 'analytics'
const TABS: { key: Tab; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'search', label: 'Search' },
  { key: 'demand', label: 'Demand' },
  { key: 'health', label: 'Health' },
  { key: 'leased', label: 'Leased' },
  { key: 'renters', label: 'Renters' },
  { key: 'analytics', label: 'Analytics' },
]

const STATUSES = [
  { value: 'active', label: 'Vacant' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'leased', label: 'Rented' },
  { value: 'inactive', label: 'Inactive' },
]
// `pending` is not a value this schema's unit_status enum accepts; the original
// had it, so it is listed for parity but filtered out of what can be saved.
const SAVEABLE = new Set(['active', 'leased', 'inactive', 'archived'])

const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? 'Inactive'

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'gold' }) {
  return (
    <div className="kpi-cell">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${tone ? ' ' + tone : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

export function InventoryConsole({ data, gaps, health, adminEmail }: {
  data: InventoryData; gaps: GapReport; health: HealthReport; adminEmail: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('inventory')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientFilter, setClientFilter] = useState('')
  const [renterFilter, setRenterFilter] = useState('')
  const [selectedRenter, setSelectedRenter] = useState<ProspectRow | null>(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({ beds: '', priceMax: '', status: '', clientId: '', nhoods: {} })
  const [nhoodOpen, setNhoodOpen] = useState(false)
  const [editing, setEditing] = useState<ListingRow | null>(null)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const say = (msg: string, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3500)
  }

  const listings = useMemo(
    () => (clientId ? data.listings.filter((l) => l.clientId === clientId) : data.listings),
    [data.listings, clientId])

  const shownClients = data.clients.filter((c) => c.name.toLowerCase().includes(clientFilter.toLowerCase()))
  const shownRenters = data.prospects.filter((p) => p.name.toLowerCase().includes(renterFilter.toLowerCase()))

  // ── inventory KPIs ──
  const vacant = listings.filter((l) => l.status === 'active')
  const rented = listings.filter((l) => l.status === 'leased')
  const buildings = new Set(listings.map((l) => l.address)).size
  const doms = vacant.map((l) => l.daysOnMarket ?? 0).sort((a, b) => a - b)
  const medianDom = doms.length ? doms[Math.floor(doms.length / 2)] : 0
  const longestDom = doms.length ? doms[doms.length - 1] : 0
  const vacantRent = vacant.reduce((s, l) => s + (l.rentCents ?? 0), 0)

  const grouped = useMemo(() => {
    const m = new Map<string, ListingRow[]>()
    for (const l of listings) {
      const k = l.address || 'Unknown'
      const arr = m.get(k)
      if (arr) arr.push(l); else m.set(k, [l])
    }
    return [...m.entries()]
  }, [listings])

  const { results: searchResults, parsed } = useMemo(
    () => runSearch(listings, query, filters, data.clients),
    [listings, query, filters, data.clients])

  const allNhoodOptions = useMemo(
    () => [...new Set([...NHOODS, ...data.listings.map((l) => l.neighborhood).filter(Boolean) as string[]])].sort(),
    [data.listings])

  const allNhoods = useMemo(
    () => [...new Set(listings.map((l) => l.neighborhood).filter(Boolean) as string[])].sort(),
    [listings])

  async function patchUnit(id: string, body: Record<string, unknown>, msg: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/units/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        say(j.error ?? `Failed (${res.status})`, true)
        return false
      }
      say(msg)
      router.refresh()
      return true
    } catch {
      say('Network error — nothing changed', true)
      return false
    } finally { setBusy(false) }
  }

  /** The original coupled status to marketplace visibility. This schema has no
   *  separate publish flag — status IS the gate — so the coupling is inherent
   *  and the toast says exactly what changed. */
  function changeStatus(l: ListingRow, s: string) {
    if (!SAVEABLE.has(s)) { say(`"${statusLabel(s)}" is not a stored status in this schema`, true); return }
    const note = s === 'active' ? 'Marked as Vacant — published on Nessoo'
      : s === 'leased' ? 'Marked as Rented — removed from Nessoo'
      : 'Marked as Inactive — removed from Nessoo'
    void patchUnit(l.id, { status: s }, note)
  }

  const renterMatches = (_p: ProspectRow) => [] as ListingRow[]   // see the Renters tab note

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo-icon">&#10022;&#10022;</span>
          <span className="topbar-brand">nessoo<span>Inventory</span></span>
        </div>
        <div className="topbar-right">
          <a className="btn-topbar" href="/">Admin Dashboard</a>
          <span className="avatar">{adminEmail.slice(0, 2).toUpperCase()}</span>
        </div>
      </div>

      <div className="tab-nav">
        {TABS.map((t) => (
          <button key={t.key} className={`tab-pill${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inventory' && (
        <div className="action-bar">
          <div className="action-bar-left">Listings &middot; {listings.length} Units</div>
          <div className="action-bar-right">
            <div className="view-toggle">
              <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>Cards</button>
              <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
            </div>
          </div>
        </div>
      )}

      <div className="app-shell">
        <aside className="sidebar">
          {tab === 'renters' ? (
            <>
              <div className="sidebar-header">
                <div className="sidebar-label">Renters</div>
                <input className="sidebar-search" placeholder="Filter renters..." value={renterFilter} onChange={(e) => setRenterFilter(e.target.value)} />
              </div>
              <div className="sidebar-list">
                <button className={`client-item${!selectedRenter ? ' active' : ''}`} onClick={() => setSelectedRenter(null)}>
                  <span className="client-name">All Renters</span>
                  <span className="client-count">{data.prospects.length}</span>
                </button>
                {shownRenters.map((p) => (
                  <button key={p.id} className={`client-item${selectedRenter?.id === p.id ? ' active' : ''}`} onClick={() => setSelectedRenter(p)}>
                    <span className="client-name">{p.name}</span>
                    <span className={`renter-status-badge ${p.status}`}>{p.status}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-header">
                <div className="sidebar-label">Clients</div>
                <input className="sidebar-search" placeholder="Filter clients..." value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} />
              </div>
              <div className="sidebar-list">
                <button className={`client-item${!clientId ? ' active' : ''}`} onClick={() => setClientId(null)}>
                  <span className="client-name">All Clients</span>
                  <span className="client-count">{data.clients.reduce((s, c) => s + c.unitCount, 0)}</span>
                </button>
                {shownClients.map((c) => (
                  <button key={c.id} className={`client-item${clientId === c.id ? ' active' : ''}`} onClick={() => setClientId(c.id)}>
                    <span className="client-name">{c.name}</span>
                    <span className="client-count">{c.unitCount}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <div className="content"><div className="main">

          {/* ── INVENTORY ─────────────────────────────────── */}
          {tab === 'inventory' && (
            <>
              <div className="kpi-row">
                <Kpi label="Units" value={listings.length} sub={`${buildings} building${buildings === 1 ? '' : 's'}`} />
                <Kpi label="Vacant" value={vacant.length} sub="available now" />
                <Kpi label="Rented" value={rented.length} sub="occupied" />
                <Kpi label="Median Days Vacant" value={medianDom} sub={longestDom ? `longest ${longestDom}d` : ''} />
                <Kpi label="Rent Vacant / Mo" value={fmtPrice(vacantRent)} sub="sum of vacant asking rent" tone="gold" />
              </div>

              {listings.length === 0 ? (
                <div className="empty-state"><h3>No listings yet</h3><p>Add a unit, or pick a different client in the sidebar.</p></div>
              ) : view === 'cards' ? (
                <>
                  <h2 className="section-heading">Your buildings</h2>
                  {grouped.map(([address, units]) => {
                    const v = units.filter((u) => u.status === 'active')
                    const r = units.filter((u) => u.status === 'leased')
                    const occ = units.length ? Math.round((r.length / units.length) * 100) : 0
                    const rent = v.reduce((s, u) => s + (u.rentCents ?? 0), 0)
                    return (
                      <div className="building-group" key={address}>
                        <div className="building-header">
                          <div>
                            <div className="building-name">{address.split(',')[0]}</div>
                            <div className="building-address">
                              {address}
                              {units[0].neighborhood ? ` · ${units[0].neighborhood}` : ''}
                              {units[0].clientName ? ` · ${units[0].clientName}` : ''}
                            </div>
                          </div>
                          <div className="building-right">
                            <div className="building-rent">{fmtPrice(rent)}</div>
                            <div className="building-rent-label">Rent Vacant / Mo</div>
                            <div className="building-occ">{occ}% Occupied</div>
                          </div>
                        </div>
                        <div className="occupancy-bar"><div className="occupancy-fill" style={{ width: `${occ}%` }} /></div>
                        <div className="building-count">{v.length} Vacant &middot; {r.length} Rented</div>
                        <div className="unit-grid">
                          {units.map((u) => <UnitCard key={u.id} l={u} busy={busy} onOpen={() => setEditing(u)} onStatus={changeStatus} />)}
                        </div>
                      </div>
                    )
                  })}
                </>
              ) : (
                <div className="table-wrap scroll-x">
                  <table>
                    <thead><tr>
                      <th>Address</th><th>Unit</th><th>Beds/Baths</th><th>Price</th><th>Neighborhood</th>
                      <th>Client</th><th>Status</th><th>Live</th><th>Available</th><th />
                    </tr></thead>
                    <tbody>
                      {listings.map((l) => (
                        <tr key={l.id}>
                          <td className="td-primary">{l.address}</td>
                          <td>{l.unit}</td>
                          <td>{bedsLabel(l.bedrooms)}{l.bathrooms ? ` / ${l.bathrooms}BA` : ''}</td>
                          <td className="td-gold">{fmtPrice(l.rentCents)}</td>
                          <td>{l.neighborhood ?? '--'}</td>
                          <td>{l.clientName}</td>
                          <td>
                            <select className="status-select" value={l.status} disabled={busy} onChange={(e) => changeStatus(l, e.target.value)}>
                              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          </td>
                          <td>{l.isPublished ? <span className="badge badge-green">live</span> : <span className="badge badge-muted">hidden</span>}</td>
                          <td>{fmtDate(l.availableFrom)}</td>
                          <td><div className="row-actions"><button className="btn-icon" title="Edit" onClick={() => setEditing(l)}>&#9998;</button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── SEARCH ────────────────────────────────────── */}
          {tab === 'search' && (
            <>
              <div className="search-hero">
                <h2>Find the Perfect Unit</h2>
                <p>Search naturally or use filters. Try &ldquo;2BR under $2,000 in Brooklyn&rdquo; or &ldquo;studio with laundry&rdquo;</p>
                <div className="search-bar-wrap">
                  <span className="search-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  </span>
                  <input className="search-bar" placeholder="Search inventory..." value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="search-parsed">
                  {parsed && !parsed.recognisedNothing && describeParsed(parsed).length > 0 && (
                    <>Searching: {describeParsed(parsed).map((p, i) => (
                      <span key={i}>{i > 0 && ', '}<strong>{p}</strong></span>
                    ))}</>
                  )}
                  {parsed?.recognisedNothing && <>Matching <strong>{query.trim()}</strong> across address, unit, neighborhood and features</>}
                </div>
                <div className="filter-bar centered">
                  <select className="filter-select" value={filters.beds} onChange={(e) => setFilters({ ...filters, beds: e.target.value })}>
                    <option value="">All Beds</option><option value="0">Studio</option>
                    <option value="1">1 BR</option><option value="2">2 BR</option>
                    <option value="3">3 BR</option><option value="4">4 BR</option>
                  </select>
                  <select className="filter-select" value={filters.priceMax} onChange={(e) => setFilters({ ...filters, priceMax: e.target.value })}>
                    <option value="">Any Price</option>
                    {[1500, 2000, 2500, 3000, 4000, 5000].map((p) => <option key={p} value={p}>Under ${p.toLocaleString()}</option>)}
                  </select>
                  <div className="nhood-filter-wrap">
                    <button className="filter-select" style={{ textAlign: 'left', minWidth: 180 }} onClick={() => setNhoodOpen(!nhoodOpen)}>
                      {nhoodLabel(filters.nhoods)} &#9662;
                    </button>
                    {nhoodOpen && (
                      <div className="nhood-panel">
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                          <button className="nhood-btn" onClick={() => setFilters({ ...filters, nhoods: Object.fromEntries(allNhoods.map((n) => [n, 'include' as const])) })}>Include All</button>
                          <button className="nhood-btn" onClick={() => setFilters({ ...filters, nhoods: Object.fromEntries(allNhoods.map((n) => [n, 'exclude' as const])) })}>Exclude All</button>
                          <button className="nhood-btn" onClick={() => setFilters({ ...filters, nhoods: {} })}>Clear</button>
                        </div>
                        {allNhoods.map((n) => (
                          <div className="nhood-row" key={n}>
                            <span className="nhood-name">{n}</span>
                            <button className={`nhood-btn${filters.nhoods[n] === 'include' ? ' include' : ''}`} onClick={() => setFilters({ ...filters, nhoods: toggleNhood(filters.nhoods, n, 'include') })}>+</button>
                            <button className={`nhood-btn${filters.nhoods[n] === 'exclude' ? ' exclude' : ''}`} onClick={() => setFilters({ ...filters, nhoods: toggleNhood(filters.nhoods, n, 'exclude') })}>-</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <select className="filter-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                    <option value="">All Status</option>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <select className="filter-select" value={filters.clientId} onChange={(e) => setFilters({ ...filters, clientId: e.target.value })}>
                    <option value="">All Clients</option>
                    {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="search-results-count">{searchResults.length} listing{searchResults.length === 1 ? '' : 's'} found</div>
              {searchResults.length === 0 ? (
                <div className="empty-state"><h3>No results</h3><p>Try adjusting your search or filters.</p></div>
              ) : (
                <div className="unit-grid">
                  {searchResults.slice(0, 300).map((l) => (
                    <UnitCard key={l.id} l={l} busy={busy} onOpen={() => setEditing(l)} onStatus={changeStatus} showAddress />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── DEMAND ────────────────────────────────────── */}
          {tab === 'demand' && <DemandTab gaps={gaps} />}

          {/* ── HEALTH ────────────────────────────────────── */}
          {tab === 'health' && <HealthTab health={health} neighborhoods={allNhoodOptions} />}

          {/* ── LEASED ────────────────────────────────────── */}
          {tab === 'leased' && <LeasedTab listings={listings} />}

          {/* ── RENTERS ───────────────────────────────────── */}
          {tab === 'renters' && (
            <RentersTab
              prospects={data.prospects}
              selected={selectedRenter}
              onSelect={setSelectedRenter}
              matches={renterMatches}
            />
          )}

          {/* ── ANALYTICS ─────────────────────────────────── */}
          {tab === 'analytics' && <AnalyticsTab listings={listings} />}

        </div></div>
      </div>

      {editing && <ListingModal l={editing} busy={busy} onClose={() => setEditing(null)} onSave={patchUnit} />}
      {toast && <div className="toast-container"><div className={`toast${toast.error ? ' error' : ''}`}>{toast.msg}</div></div>}
    </>
  )
}

function toggleNhood(m: Record<string, 'include' | 'exclude'>, n: string, mode: 'include' | 'exclude') {
  const next = { ...m }
  if (next[n] === mode) delete next[n]; else next[n] = mode
  return next
}
function nhoodLabel(m: Record<string, 'include' | 'exclude'>) {
  const inc = Object.values(m).filter((v) => v === 'include').length
  const exc = Object.values(m).filter((v) => v === 'exclude').length
  if (!inc && !exc) return 'All Neighborhoods'
  if (inc && exc) return `${inc} in / ${exc} out`
  return inc ? `${inc} included` : `${exc} excluded`
}

function UnitCard({ l, busy, onOpen, onStatus, showAddress }: {
  l: ListingRow; busy: boolean; onOpen: () => void
  onStatus: (l: ListingRow, s: string) => void; showAddress?: boolean
}) {
  return (
    <div className="unit-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="unit-top">
        <div className="unit-top-left">
          <span className="unit-number">{l.unit || '--'}</span>
          <span className="unit-beds">{bedsLabel(l.bedrooms)}</span>
          <span className="unit-price">{fmtPrice(l.rentCents)}/mo</span>
        </div>
        <div className="unit-top-right">
          <span className={`status-dot ${l.status}`} />
          {statusLabel(l.status)}{l.daysOnMarket !== null ? ` · ${l.daysOnMarket}D` : ''}
        </div>
      </div>
      {showAddress && <div className="building-address" style={{ marginBottom: 8 }}>{l.address}</div>}
      {(l.incomeRequirement || l.securityDepositCents) && (
        <div className="unit-tags">
          {l.incomeRequirement && <span className="unit-tag">{l.incomeRequirement}</span>}
          {l.securityDepositCents ? <span className="unit-tag">{fmtPrice(l.securityDepositCents)} dep</span> : null}
        </div>
      )}
      {l.features.length > 0 && (
        <div className="unit-features">
          {l.features.slice(0, 3).map((f) => <span className="feature-pill" key={f}>{f}</span>)}
        </div>
      )}
      <div className="unit-footer" onClick={(e) => e.stopPropagation()}>
        <select className="status-select" value={l.status} disabled={busy} onChange={(e) => onStatus(l, e.target.value)}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className={`badge ${l.isPublished ? 'badge-green' : 'badge-muted'}`}>
          {l.isPublished ? 'live' : 'hidden'}
        </span>
      </div>
    </div>
  )
}

function LeasedTab({ listings }: { listings: ListingRow[] }) {
  const leased = listings.filter((l) => l.status === 'leased')
  const now = new Date()
  const thisMonth = leased.filter((l) => {
    const d = new Date(l.updatedAt)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const rent = leased.reduce((s, l) => s + (l.rentCents ?? 0), 0)
  return (
    <>
      <div className="kpi-row">
        <Kpi label="Total Leased" value={leased.length} sub={`${leased.length} units occupied`} />
        <Kpi label="Updated This Month" value={thisMonth.length} sub="current month" />
        <Kpi label="Total Rent Leased" value={fmtPrice(rent)} sub="monthly revenue" tone="gold" />
      </div>
      <h2 className="section-heading">Leased Units</h2>
      <div className="table-wrap scroll-x">
        <table>
          <thead><tr><th>Address</th><th>Unit</th><th>Beds/Baths</th><th>Price</th><th>Neighborhood</th><th>Client</th><th>Last Updated</th></tr></thead>
          <tbody>
            {leased.length === 0 && <tr><td colSpan={7} className="table-empty">No leased units yet.</td></tr>}
            {leased.map((l) => (
              <tr key={l.id}>
                <td className="td-primary">{l.address}</td>
                <td>{l.unit}</td>
                <td>{bedsLabel(l.bedrooms)}{l.bathrooms ? ` / ${l.bathrooms}BA` : ''}</td>
                <td className="td-gold">{fmtPrice(l.rentCents)}</td>
                <td>{l.neighborhood ?? '--'}</td>
                <td>{l.clientName}</td>
                <td>{fmtDate(l.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caveat">
        &ldquo;Updated This Month&rdquo; counts any edit, not specifically the lease date — this schema
        has no leased_at column, exactly as the original did not. A unit edited for an unrelated
        reason counts here too.
      </p>
    </>
  )
}

function RentersTab({ prospects, selected, onSelect, matches }: {
  prospects: ProspectRow[]
  selected: ProspectRow | null
  onSelect: (p: ProspectRow | null) => void
  matches: (p: ProspectRow) => ListingRow[]
}) {
  const active = prospects.filter((p) => p.status === 'active').length
  const placed = prospects.filter((p) => p.status === 'placed').length
  const budget = (p: ProspectRow) =>
    p.budgetMinCents || p.budgetMaxCents ? `${fmtPrice(p.budgetMinCents)} - ${fmtPrice(p.budgetMaxCents)}` : 'Not set'

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Total Renters" value={prospects.length} sub="migrated leads" />
        <Kpi label="Active" value={active} sub="searching" />
        <Kpi label="Placed" value={placed} sub="leased up" />
        <Kpi label="Placement Rate" value={prospects.length ? Math.round((placed / prospects.length) * 100) + '%' : '0%'} sub="placed / total" tone="gold" />
      </div>

      {!selected ? (
        prospects.length === 0 ? (
          <div className="empty-state"><h3>No renters yet</h3><p>The migrated lead list is empty.</p></div>
        ) : (
          <div className="renter-grid">
            {prospects.map((p) => (
              <div className="renter-card" key={p.id} role="button" tabIndex={0}
                onClick={() => onSelect(p)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(p) }}>
                <div className="renter-card-name">{p.name}</div>
                <div className="renter-card-contact">{[p.email, p.phone].filter(Boolean).join(' · ') || 'No contact on file'}</div>
                <div className="renter-card-prefs">
                  {(p.budgetMinCents || p.budgetMaxCents) && <span className="spec-tag">{budget(p)}</span>}
                  {p.bedroomsNeeded !== null && <span className="spec-tag">{bedsLabel(p.bedroomsNeeded)}</span>}
                  {p.neighborhoods.slice(0, 2).map((n) => <span className="feature-pill" key={n}>{n}</span>)}
                </div>
                <div className="renter-card-footer">
                  <span className="renter-card-matches">{matches(p).length} matches</span>
                  <span className={`renter-status-badge ${p.status}`}>{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="renter-profile-header">
            <div className="renter-profile-top">
              <div>
                <div className="renter-profile-name">{selected.name}</div>
                <div className="renter-profile-contact">{[selected.email, selected.phone].filter(Boolean).join(' · ') || 'No contact on file'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`renter-status-badge ${selected.status}`}>{selected.status}</span>
                <button className="btn-secondary sm" onClick={() => onSelect(null)}>Back to all</button>
              </div>
            </div>
            <div className="renter-profile-prefs">
              <div><div className="renter-pref-label">Budget</div><div className="renter-pref-value">{budget(selected)}</div></div>
              <div><div className="renter-pref-label">Bedrooms</div><div className="renter-pref-value">{selected.bedroomsNeeded === null ? 'Any' : bedsLabel(selected.bedroomsNeeded)}</div></div>
              <div><div className="renter-pref-label">Neighborhoods</div><div className="renter-pref-value">{selected.neighborhoods.length ? selected.neighborhoods.join(', ') : 'Any'}</div></div>
              <div><div className="renter-pref-label">Move-in</div><div className="renter-pref-value">{selected.moveInDate ? fmtDate(selected.moveInDate) : 'Flexible'}</div></div>
              <div><div className="renter-pref-label">Added</div><div className="renter-pref-value">{fmtDate(selected.createdAt)}</div></div>
              <div><div className="renter-pref-label">Source</div><div className="renter-pref-value">migrated</div></div>
            </div>
            {selected.notes && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {selected.notes}
              </div>
            )}
          </div>
          <p className="caveat">
            These 42 leads migrated from the retired Supabase project. The original&apos;s
            send-a-unit match pipeline is not rebuilt: its <code>renter_matches</code> table was
            empty, and this database already uses that name for a completely different,
            system-computed concept. Rebuilding it needs a fresh table and a deliberate decision
            about whether leads belong to the platform or to each landlord.
          </p>
        </>
      )}
    </>
  )
}

function AnalyticsTab({ listings }: { listings: ListingRow[] }) {
  const tally = (key: (l: ListingRow) => string | null) => {
    const m = new Map<string, number>()
    for (const l of listings) {
      const k = key(l) ?? 'Unknown'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const nbhd = tally((l) => l.neighborhood).slice(0, 12)
  const clients = tally((l) => l.clientName).slice(0, 10)
  const beds = tally((l) => bedsLabel(l.bedrooms))
  const status = tally((l) => statusLabel(l.status))

  const priceBuckets = ['$0-1k', '$1-1.5k', '$1.5-2k', '$2-2.5k', '$2.5-3k', '$3-4k', '$4-5k', '$5k+']
  const priceCounts = new Array(8).fill(0)
  for (const l of listings) {
    const d = (l.rentCents ?? 0) / 100
    if (!d) continue
    const i = d < 1000 ? 0 : d < 1500 ? 1 : d < 2000 ? 2 : d < 2500 ? 3 : d < 3000 ? 4 : d < 4000 ? 5 : d < 5000 ? 6 : 7
    priceCounts[i]++
  }

  const domBuckets = ['0-7', '8-14', '15-30', '31-60', '60+']
  const domCounts = new Array(5).fill(0)
  for (const l of listings.filter((x) => x.status === 'active')) {
    const d = l.daysOnMarket ?? 0
    const i = d <= 7 ? 0 : d <= 14 ? 1 : d <= 30 ? 2 : d <= 60 ? 3 : 4
    domCounts[i]++
  }

  const empty = listings.length === 0
  return (
    <div className="charts-grid">
      <ChartCard title="Inventory by Neighborhood" empty={empty || !nbhd.length}>
        <BarChart horizontal labels={nbhd.map((r) => r[0])} data={nbhd.map((r) => r[1])} />
      </ChartCard>
      <ChartCard title="Price Distribution" empty={empty}>
        <BarChart labels={priceBuckets} data={priceCounts} color="#c9a84c" />
      </ChartCard>
      <ChartCard title="Bedroom Breakdown" empty={empty}>
        <DoughnutChart labels={beds.map((r) => r[0])} data={beds.map((r) => r[1])} />
      </ChartCard>
      <ChartCard title="Days on Market" empty={empty} emptyNote="No vacant units to measure.">
        <BarChart labels={domBuckets} data={domCounts} color="#60a5fa" />
      </ChartCard>
      <ChartCard title="Inventory by Client" empty={empty}>
        <BarChart horizontal labels={clients.map((r) => r[0])} data={clients.map((r) => r[1])} color="#22d3ee" />
      </ChartCard>
      <ChartCard title="Status Breakdown" empty={empty}>
        <DoughnutChart labels={status.map((r) => r[0])} data={status.map((r) => r[1])}
          colors={status.map((r) => r[0] === 'Vacant' ? '#4ade80' : r[0] === 'Rented' ? '#60a5fa' : r[0] === 'Pending' ? '#fbbf24' : '#5e5a4e')} />
      </ChartCard>
    </div>
  )
}

function ListingModal({ l, busy, onClose, onSave }: {
  l: ListingRow; busy: boolean; onClose: () => void
  onSave: (id: string, body: Record<string, unknown>, msg: string) => Promise<boolean>
}) {
  const [name, setName] = useState(l.unit)
  const [beds, setBeds] = useState(l.bedrooms === null ? '' : String(l.bedrooms))
  const [rent, setRent] = useState(l.rentCents === null ? '' : String(l.rentCents / 100))
  const [status, setStatus] = useState(l.status)

  async function save() {
    const body: Record<string, unknown> = { name, status }
    body.bedrooms = beds === '' ? null : Number(beds)
    body.rentDollars = rent === '' ? null : Number(rent)
    if (await onSave(l.id, body, 'Listing updated')) onClose()
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>Edit Listing</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Building</label>
              <input value={l.address} disabled />
            </div>
            <div className="form-group"><label>Unit</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="form-group">
              <label>Bedrooms</label>
              <select value={beds} onChange={(e) => setBeds(e.target.value)}>
                <option value="">Not set</option><option value="0">Studio</option>
                {[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Price ($/mo)</label><input type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} /></div>
            <div className="form-group">
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.filter((s) => SAVEABLE.has(s.value)).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Neighborhood</label><input value={l.neighborhood ?? ''} disabled /></div>
            <div className="form-group"><label>Client</label><input value={l.clientName} disabled /></div>
          </div>
          <p className="caveat">
            Status is the marketplace switch: <strong>Vacant</strong> publishes the unit,
            anything else removes it. This schema has no separate publish flag, so the two can
            never disagree. Building, neighborhood and client are read-only here — moving a unit
            between buildings or organizations is not something to do by accident.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>Save Listing</button>
        </div>
      </div>
    </div>
  )
}
