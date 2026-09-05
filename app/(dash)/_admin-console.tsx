'use client'

import { useMemo, useState } from 'react'
import type { AdminData } from '@/lib/queries/admin'
import type { AdminUserRow, FlaggedGroups } from '@/lib/queries/users'
import { fmtDate, fmtPrice, relTime, daysSince, pct, CHART_COLORS } from '@/lib/format'
import { ChartCard, LineChart, BarChart, DoughnutChart } from './_chart'

type Tab = 'users' | 'flagged' | 'activity' | 'analytics' | 'searches' | 'listings' | 'system' | 'revenue'

const TABS: { key: Tab; label: string; icon: JSX.Element }[] = [
  { key: 'users', label: 'Users', icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></> },
  { key: 'flagged', label: 'Flagged', icon: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></> },
  { key: 'activity', label: 'Activity', icon: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /> },
  { key: 'analytics', label: 'Analytics', icon: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></> },
  { key: 'searches', label: 'Search Demand', icon: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></> },
  { key: 'listings', label: 'Listings', icon: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></> },
  { key: 'system', label: 'System', icon: <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></> },
  { key: 'revenue', label: 'Revenue', icon: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
]

function Kpi({ label, value, sub, tone, small }: {
  label: string; value: React.ReactNode; sub?: string; tone?: 'gold' | 'green'; small?: boolean
}) {
  return (
    <div className="kpi-cell">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${tone ? ' ' + tone : ''}${small ? ' small' : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/** A figure the platform does not record. Shown instead of a fabricated number. */
const NotTracked = () => (
  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-muted)' }}>
    not tracked
  </span>
)

export function AdminConsole({ data, users, flagged, adminEmail }: {
  data: AdminData; users: AdminUserRow[]; flagged: FlaggedGroups; adminEmail: string
}) {
  const [tab, setTab] = useState<Tab>('users')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('newest')
  const [activityType, setActivityType] = useState('')
  const [detail, setDetail] = useState<AdminUserRow | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const active = (u: AdminUserRow) => {
    const d = daysSince(u.lastActive)
    return d !== null && d <= 7
  }

  const filtered = useMemo(() => {
    let list = users
    const term = q.trim().toLowerCase()
    if (term) list = list.filter((u) => (u.name ?? '').toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
    if (status === 'active') list = list.filter(active)
    else if (status === 'inactive') list = list.filter((u) => !active(u))
    else if (status === 'verified') list = list.filter((u) => u.emailVerified)
    else if (status === 'unverified') list = list.filter((u) => !u.emailVerified)
    const out = [...list]
    if (sort === 'newest') out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    else if (sort === 'oldest') out.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    else if (sort === 'name') out.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))
    else if (sort === 'lastActive') out.sort((a, b) => +new Date(b.lastActive ?? 0) - +new Date(a.lastActive ?? 0))
    return out
  }, [users, q, status, sort])

  const activeCount = users.filter(active).length
  const verifiedCount = users.filter((u) => u.emailVerified).length
  const thisWeek = users.filter((u) => (daysSince(u.createdAt) ?? 99) <= 7).length

  /** Exports respect the current filter — the original always dumped everything,
   *  which quietly ignored whatever the operator had narrowed down to. */
  async function copyEmails(list: AdminUserRow[], label: string) {
    const emails = list.map((u) => u.email).join(', ')
    try {
      await navigator.clipboard.writeText(emails)
      setCopied(`Copied ${list.length} ${label}`)
    } catch {
      setCopied('Clipboard blocked by the browser')
    }
    setTimeout(() => setCopied(null), 3500)
  }

  function downloadCsv(list: AdminUserRow[]) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['Name', 'Email', 'Phone', 'Role', 'Market', 'Email verified', 'Signed up', 'Last active', 'Connections'],
      ...list.map((u) => [u.name, u.email, u.phone, u.role, u.market, u.emailVerified ? 'yes' : 'no',
        u.createdAt.slice(0, 10), u.lastActive?.slice(0, 10) ?? '', u.connections]),
    ]
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nessoo-users-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    setCopied(`Downloaded ${list.length} rows`)
    setTimeout(() => setCopied(null), 3500)
  }

  const visibleActivity = activityType
    ? data.activity.events.filter((e) => e.type === activityType)
    : data.activity.events

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo-icon">&#10022;&#10022;</span>
          <span className="topbar-brand">nessoo<span>Admin</span></span>
        </div>
        <div className="topbar-right">
          <a className="topbar-link btn-topbar" href="/inventory">Inventory Dashboard</a>
          <span className="avatar">{adminEmail.slice(0, 2).toUpperCase()}</span>
        </div>
      </div>

      <nav className="mobile-nav">
        {TABS.map((t) => (
          <button key={t.key} className={`nav-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-header"><div className="sidebar-label">Admin</div></div>
          <div className="sidebar-list">
            {TABS.map((t) => (
              <button key={t.key} className={`nav-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                <svg className="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
                {t.label}
              </button>
            ))}
          </div>
        </aside>

        <div className="content"><div className="main">

          {/* ── USERS ─────────────────────────────────────── */}
          {tab === 'users' && (
            <>
              <div className="hero">
                <div className="hero-label">Total Platform Users</div>
                <div className="hero-count">{users.length.toLocaleString()}</div>
                <div className="hero-growth">{thisWeek > 0 ? `+${thisWeek} this week` : ''}</div>
              </div>
              <div className="kpi-row">
                <Kpi label="Total Users" value={users.length} sub="all time signups" />
                <Kpi label="This Week" value={thisWeek} sub="new signups" tone="green" />
                <Kpi label="Active Users" value={activeCount} sub="signed in last 7 days" />
                <Kpi label="Email Verified" value={verifiedCount} sub="confirmed address" />
                <Kpi label="Activation Rate" value={pct(activeCount, users.length)} sub="signup → active" tone="gold" />
              </div>

              <div className="filter-bar">
                <input className="filter-input" placeholder="Search by name or email..." value={q} onChange={(e) => setQ(e.target.value)} />
                <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="verified">Verified</option>
                  <option value="unverified">Unverified</option>
                </select>
                <select className="filter-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="name">Name A-Z</option>
                  <option value="lastActive">Last Active</option>
                </select>
                <button className="btn-primary sm push-right" onClick={() => copyEmails(filtered, 'emails')}>
                  Copy {filtered.length === users.length ? 'All' : 'Filtered'} Emails
                </button>
                <button className="btn-secondary sm" onClick={() => downloadCsv(filtered)}>Download CSV</button>
              </div>

              <div className="table-wrap scroll-x">
                <table>
                  <thead><tr>
                    <th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th>
                    <th>Signed Up</th><th>Last Active</th><th>Preferences</th><th>Connections</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 && <tr><td colSpan={9} className="table-empty">No users found.</td></tr>}
                    {filtered.map((u) => (
                      <tr key={u.id} className="row-click" onClick={() => setDetail(u)}>
                        <td className="td-primary">{u.name ?? '--'}</td>
                        <td>{u.email}</td>
                        <td>{u.phone ?? '--'}</td>
                        <td>{u.role}</td>
                        <td>
                          <span className={`badge ${active(u) ? 'badge-green' : 'badge-muted'}`}>{active(u) ? 'active' : 'inactive'}</span>
                          {u.emailVerified && <span className="badge badge-blue" style={{ marginLeft: 4 }}>verified</span>}
                        </td>
                        <td>{fmtDate(u.createdAt)}</td>
                        <td>{u.lastActive ? fmtDate(u.lastActive) : 'never'}</td>
                        <td>{u.preferredBedrooms !== null ? (u.preferredBedrooms === 0 ? 'Studio' : `${u.preferredBedrooms}BR`) : '--'} &middot; {fmtPrice(u.preferredMaxRent)}</td>
                        <td>{u.connections}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="caveat">
                Profile rows are created on a user&apos;s first authenticated action, so anyone who
                registered and never returned has no preferences on file at all. The total above is
                complete; the Preferences column is blank for those accounts rather than missing.
              </p>
            </>
          )}

          {/* ── FLAGGED ───────────────────────────────────── */}
          {tab === 'flagged' && (
            <>
              <div className="kpi-row">
                <Kpi label="Never Returned" value={flagged.neverReturned.length} sub="signed up, one session" />
                <Kpi label="Went Quiet" value={flagged.wentQuiet.length} sub="no activity in 14+ days" />
                <Kpi label="0 Connections" value={flagged.noConnections} sub="never connected" />
                <Kpi label="Stalled Verification" value={flagged.startedNotFinishedVerification.length} sub="started, not finished" tone="gold" />
              </div>

              <FlaggedTable
                title="Never Returned"
                note="Registered more than 3 days ago and has only ever had one session. The most recoverable cohort — they wanted something and never came back for it."
                rows={flagged.neverReturned}
                issue={(u) => `${daysSince(u.createdAt)} days since signup`}
                onPick={setDetail}
                onCopy={(rows) => copyEmails(rows, 'emails')}
              />
              <FlaggedTable
                title="Went Quiet"
                note="Signed in more than once, then nothing for two weeks or more."
                rows={flagged.wentQuiet}
                issue={(u) => `quiet ${daysSince(u.lastActive)} days`}
                onPick={setDetail}
                onCopy={(rows) => copyEmails(rows, 'emails')}
              />
              <FlaggedTable
                title="Stalled Mid-Verification"
                note="Completed one of income or identity but not both. They have already done the hard part."
                rows={flagged.startedNotFinishedVerification}
                issue={(u) => (u.incomeVerified ? 'income done, identity missing' : 'identity done, income missing')}
                onPick={setDetail}
                onCopy={(rows) => copyEmails(rows, 'emails')}
              />
              <FlaggedTable
                title="Email Never Verified"
                note="Never confirmed their address, so they cannot receive anything we send."
                rows={flagged.emailUnverified}
                issue={() => 'email unverified'}
                onPick={setDetail}
                onCopy={(rows) => copyEmails(rows, 'emails')}
              />
              <p className="caveat">
                These cohorts use stated rules, not judgement: the original dashboard listed
                hand-written names with no rule behind them. Change a threshold and every number
                here changes — they are a starting point for outreach, not a verdict.
              </p>
            </>
          )}

          {/* ── ACTIVITY ──────────────────────────────────── */}
          {tab === 'activity' && (
            <>
              <div className="kpi-row">
                <Kpi label="Events Today" value={data.activity.eventsToday} sub="platform actions" />
                <Kpi label="Signups Today" value={data.activity.signupsToday} sub="new accounts" tone="green" />
                <Kpi label="Connections Today" value={data.activity.connectionsToday} sub="accepted" />
                <Kpi label="Listing Views Today" value={data.activity.viewsToday} sub="tracked views" />
              </div>
              <div className="filter-bar">
                <select className="filter-select" value={activityType} onChange={(e) => setActivityType(e.target.value)}>
                  <option value="">All Events</option>
                  <option value="signup">Signups</option>
                  <option value="view">Views</option>
                  <option value="connect">Connections</option>
                  <option value="apply">Requests</option>
                  <option value="verify">Verifications</option>
                </select>
              </div>
              <h3 className="section-heading sm">Live Activity Feed</h3>
              <div className="table-wrap" style={{ padding: 16 }}>
                <div className="activity-feed">
                  {visibleActivity.length === 0 && (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No events of this type yet.
                    </div>
                  )}
                  {visibleActivity.map((e, i) => (
                    <div className="activity-item" key={i}>
                      <span className={`activity-dot ${e.type}`} />
                      <div>
                        <div className="activity-text"><strong>{e.user}</strong> {e.detail}</div>
                        <div className="activity-time">{relTime(e.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {data.activity.viewsToday === 0 && (
                <p className="caveat">
                  Listing-view tracking began on 4 September 2026, so view events only exist from
                  then onward. Signups, connections and requests are complete history.
                </p>
              )}
            </>
          )}

          {/* ── ANALYTICS ─────────────────────────────────── */}
          {tab === 'analytics' && (
            <>
              <div className="kpi-row">
                <Kpi label="Total Signups" value={data.analytics.totalSignups} sub="all time" />
                <Kpi label="Monthly Growth"
                  value={data.analytics.monthlyGrowthPct === null ? <NotTracked /> : `${data.analytics.monthlyGrowthPct > 0 ? '+' : ''}${data.analytics.monthlyGrowthPct}%`}
                  sub="vs last month" tone="green" />
                <Kpi label="Avg Session" value={<NotTracked />} sub="no duration data recorded" />
                <Kpi label="Retention (7d)"
                  value={data.analytics.retention7dPct === null ? <NotTracked /> : `${data.analytics.retention7dPct}%`}
                  sub="returned within 7 days" tone="gold" />
              </div>
              <div className="charts-grid">
                <ChartCard title="Signups Over Time" empty={data.analytics.signupsByDay.every((d) => d.count === 0)} emptyNote="No signups in this window.">
                  <LineChart labels={data.analytics.signupsByDay.map((d) => d.day.slice(5))} data={data.analytics.signupsByDay.map((d) => d.count)} />
                </ChartCard>
                <ChartCard title="Daily Active Users" empty={data.analytics.dauByDay.every((d) => d.count === 0)} emptyNote="No sessions in this window.">
                  <LineChart labels={data.analytics.dauByDay.map((d) => d.day.slice(5))} data={data.analytics.dauByDay.map((d) => d.count)} color="#60a5fa" />
                </ChartCard>
                <ChartCard title="Conversion Funnel">
                  <BarChart
                    labels={['Signed Up', 'Set Preferences', 'First Connection']}
                    data={[data.analytics.funnel.signedUp, data.analytics.funnel.completedProfile, data.analytics.funnel.firstConnection]}
                    colors={['#4ade80', '#c9a84c', '#a78bfa']}
                  />
                </ChartCard>
                <ChartCard title="Preferred Bedrooms" empty={!data.analytics.prefBeds.length} emptyNote="No bedroom preferences recorded yet.">
                  <DoughnutChart labels={data.analytics.prefBeds.map((r) => r[0])} data={data.analytics.prefBeds.map((r) => r[1])} />
                </ChartCard>
                <ChartCard title="Top Neighborhoods" empty={!data.analytics.topNeighborhoods.length} emptyNote="No neighborhood preferences recorded yet.">
                  <BarChart horizontal labels={data.analytics.topNeighborhoods.map((r) => r[0])} data={data.analytics.topNeighborhoods.map((r) => r[1])} />
                </ChartCard>
                <ChartCard title="Budget Distribution" empty={!data.analytics.budgetDist.length} emptyNote="No budgets recorded yet.">
                  <BarChart labels={data.analytics.budgetDist.map((r) => r[0])} data={data.analytics.budgetDist.map((r) => r[1])} color="#c9a84c" />
                </ChartCard>
              </div>
              <p className="caveat">
                The funnel starts at signup. The original began with a &ldquo;Visited&rdquo; step, but
                top-of-funnel pageviews live in Google Analytics, not this database — showing a
                number here would have been invented.
              </p>
            </>
          )}

          {/* ── SEARCH DEMAND ─────────────────────────────── */}
          {tab === 'searches' && (
            <>
              <div className="kpi-row">
                <Kpi label="Total Searches" value={data.searches.total} sub="last 30 days" />
                <Kpi label="Searches Today" value={data.searches.today} sub="platform searches" tone="green" />
                <Kpi label="No Results Rate"
                  value={data.searches.noResultsRatePct === null ? '--' : `${data.searches.noResultsRatePct}%`}
                  sub="searches with 0 matches" tone="gold" />
                <Kpi label="Top Neighborhood" value={data.searches.topSearch ?? '--'} sub="most searched" small />
              </div>
              <div className="charts-grid">
                <ChartCard title="Most Searched Neighborhoods" empty={!data.searches.byNeighborhood.length} emptyNote="No neighborhood filters used yet.">
                  <BarChart horizontal labels={data.searches.byNeighborhood.map((r) => r[0])} data={data.searches.byNeighborhood.map((r) => r[1])} />
                </ChartCard>
                <ChartCard title="Most Searched Bedroom Sizes" empty={!data.searches.byBeds.length} emptyNote="No bedroom filters used yet.">
                  <BarChart labels={data.searches.byBeds.map((r) => r[0])} data={data.searches.byBeds.map((r) => r[1])} color="#c9a84c" />
                </ChartCard>
              </div>

              <h3 className="section-heading sm" style={{ marginTop: 24 }}>Recent Searches</h3>
              <p className="section-note">What renters are filtering for. Gaps between demand and inventory are the opportunity.</p>
              <div className="table-wrap scroll-x">
                <table>
                  <thead><tr><th>User</th><th>Filters</th><th>Results</th><th>Surface</th><th>When</th></tr></thead>
                  <tbody>
                    {data.searches.recent.length === 0 && <tr><td colSpan={5} className="table-empty">No searches recorded yet.</td></tr>}
                    {data.searches.recent.map((s, i) => (
                      <tr key={i}>
                        <td className="td-primary">{s.user ?? 'Signed out'}</td>
                        <td>{describeFilters(s.filters)}</td>
                        <td>{s.results === 0 ? <span className="badge badge-red">0</span> : s.results}</td>
                        <td>{s.surface ?? '--'}</td>
                        <td>{relTime(s.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="section-heading sm" style={{ marginTop: 24 }}>Unmet Demand</h3>
              <p className="section-note">Searches that returned nothing. These are renters you are losing for lack of matching inventory.</p>
              <div className="table-wrap scroll-x">
                <table>
                  <thead><tr><th>Search</th><th>Frequency</th><th>Last Searched</th></tr></thead>
                  <tbody>
                    {data.searches.unmet.length === 0 && <tr><td colSpan={3} className="table-empty">No zero-result searches recorded.</td></tr>}
                    {data.searches.unmet.map((s, i) => (
                      <tr key={i}>
                        <td className="td-primary">{describeFilters(safeParse(s.label))}</td>
                        <td><span className="badge badge-amber">{s.frequency} searches</span></td>
                        <td>{relTime(s.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="caveat">
                Search logging began on 4 September 2026, so this covers only searches since then —
                nothing before that was ever recorded. The renter&apos;s typed text is deliberately
                never stored; only the structured filters they applied.
              </p>
            </>
          )}

          {/* ── LISTINGS ──────────────────────────────────── */}
          {tab === 'listings' && (
            <>
              <div className="kpi-row">
                <Kpi label="Most Viewed" value={data.listings.top[0]?.views ?? '--'} sub="views on top listing" />
                <Kpi label="Most Requested" value={data.listings.top[0]?.connections ?? '--'} sub="requests on top listing" />
                <Kpi label="Avg Time to Request"
                  value={data.listings.avgHoursToConnect === null ? '--' : `${data.listings.avgHoursToConnect}h`}
                  sub="after listing goes live" />
                <Kpi label="No Activity" value={data.listings.noActivityCount} sub="active units, zero interest" tone="gold" />
              </div>

              <h3 className="section-heading sm">Top Performing Listings</h3>
              {data.listings.top.length === 0 ? (
                <div className="empty-state">
                  <h3>Nothing to rank yet</h3>
                  <p>View tracking started on 4 September 2026. Requests are counted from full history, so this fills in as interest arrives.</p>
                </div>
              ) : data.listings.top.map((l, i) => (
                <div className="perf-card" key={l.unitId}>
                  <div className="perf-rank">#{i + 1}</div>
                  <div className="perf-info">
                    <div className="perf-address">{l.address} {l.unit}</div>
                    <div className="perf-meta">{l.neighborhood ?? 'No neighborhood'} &middot; {fmtPrice(l.rentCents)}</div>
                  </div>
                  <div className="perf-stat"><div className="perf-stat-value">{l.views}</div><div className="perf-stat-label">views</div></div>
                  <div className="perf-stat" style={{ marginLeft: 20 }}><div className="perf-stat-value green">{l.connections}</div><div className="perf-stat-label">requests</div></div>
                </div>
              ))}

              <h3 className="section-heading sm" style={{ marginTop: 24 }}>Longest Listed With No Activity</h3>
              {data.listings.dead.length === 0 ? (
                <div className="empty-state"><h3>Nothing stale</h3><p>Every active unit has had at least one view or request.</p></div>
              ) : data.listings.dead.map((l) => (
                <div className="perf-card" key={l.unitId}>
                  <div className="perf-info">
                    <div className="perf-address">{l.address} {l.unit}</div>
                    <div className="perf-meta">{l.neighborhood ?? 'No neighborhood'} &middot; {fmtPrice(l.rentCents)} &middot; {l.daysListed ?? '--'} days listed</div>
                  </div>
                  <span className="badge badge-red">No activity</span>
                </div>
              ))}
            </>
          )}

          {/* ── SYSTEM ────────────────────────────────────── */}
          {tab === 'system' && (
            <>
              <div className="kpi-row">
                <Kpi label="Database Size" value={data.system.dbSize} sub="storage used" small />
                <Kpi label="Migrations Applied" value={data.system.migrationsApplied} sub="schema versions" />
                <Kpi label="AI/Vendor Calls" value={data.system.apiCalls24h} sub="last 24 hours" />
                <Kpi label="Failed Calls"
                  value={data.system.apiErrors24h}
                  sub="last 24 hours"
                  tone={data.system.apiErrors24h > 0 ? 'gold' : undefined} />
              </div>
              <div className="charts-grid">
                <ChartCard title="Largest Tables By Row Count" empty={!data.system.slowestTables.length}>
                  <BarChart horizontal labels={data.system.slowestTables.map((t) => t.name)} data={data.system.slowestTables.map((t) => t.rows)} color="#60a5fa" />
                </ChartCard>
                <div className="chart-card">
                  <h3>Schema</h3>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
                    <div>Last migration: <span style={{ color: 'var(--text)' }}>{data.system.lastMigration?.filename ?? '--'}</span></div>
                    <div>Applied: <span style={{ color: 'var(--text)' }}>{data.system.lastMigration ? fmtDate(data.system.lastMigration.at) : '--'}</span></div>
                    <div>Avg AI call latency: <span style={{ color: 'var(--text)' }}>{data.system.avgLatencyMs === null ? 'not recorded' : `${data.system.avgLatencyMs}ms`}</span></div>
                  </div>
                </div>
              </div>
              <p className="caveat">
                The original showed API uptime, response time and an error rate. Those are
                infrastructure metrics that live in CloudWatch and Sentry, not in this database —
                the figures here are the ones Postgres can actually answer for. AI and vendor call
                volume comes from the usage metering added on 4 September 2026.
              </p>
            </>
          )}

          {/* ── REVENUE ───────────────────────────────────── */}
          {tab === 'revenue' && (
            <>
              <div className="kpi-row">
                <Kpi label="This Month" value={fmtPrice(data.revenue.monthCents)} sub="renter fees collected" tone="gold" />
                <Kpi label="All Time" value={fmtPrice(data.revenue.renterFeesCents)} sub={`${data.revenue.renterFeeCount} payments`} />
                <Kpi label="Client Billing" value={fmtPrice(data.revenue.orgBillingCents)} sub="billed to organizations" />
                <Kpi label="Active Subscriptions" value={data.revenue.activeSubscriptions} sub="paying organizations" />
              </div>
              <div className="charts-grid">
                <ChartCard title="Revenue Over Time" empty={data.revenue.byMonth.every((m) => m.cents === 0)} emptyNote="No payments recorded in this window.">
                  <LineChart labels={data.revenue.byMonth.map((m) => m.month)} data={data.revenue.byMonth.map((m) => m.cents / 100)} color="#c9a84c" />
                </ChartCard>
                <ChartCard title="Revenue by Source" empty={!data.revenue.bySource.length} emptyNote="No revenue recorded yet.">
                  <DoughnutChart labels={data.revenue.bySource.map((r) => r[0])} data={data.revenue.bySource.map((r) => r[1] / 100)} colors={[CHART_COLORS[0], CHART_COLORS[2]]} />
                </ChartCard>
              </div>
              <div className="kpi-row" style={{ marginTop: 20 }}>
                <Kpi label="AI Spend (all time)" value={`$${(data.revenue.aiSpendMicros / 1_000_000).toFixed(4)}`} sub="metered LLM cost" />
              </div>
              <p className="caveat">
                The original modelled a subscription business with ARPU and a
                landlord/premium/renter split that does not match how this platform actually earns.
                What is shown is what the payment tables record: renter fees, client billing events
                and active subscriptions. AI spend is estimated from per-model token pricing.
              </p>
            </>
          )}

        </div></div>
      </div>

      {detail && <UserDetail user={detail} events={data.activity.events} onClose={() => setDetail(null)} />}
      {copied && <div className="toast-container"><div className="toast">{copied}</div></div>}
    </>
  )
}

function FlaggedTable({ title, note, rows, issue, onPick, onCopy }: {
  title: string; note: string; rows: AdminUserRow[]
  issue: (u: AdminUserRow) => string
  onPick: (u: AdminUserRow) => void
  onCopy: (rows: AdminUserRow[]) => void
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 className="section-heading sm">{title}</h3>
      <p className="section-note">{note}</p>
      <div className="table-wrap scroll-x">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Signed Up</th><th>Last Active</th><th>Issue</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="table-empty">Nobody in this cohort.</td></tr>}
            {rows.slice(0, 50).map((u) => (
              <tr key={u.id} className="row-click" onClick={() => onPick(u)}>
                <td className="td-primary">{u.name ?? '--'}</td>
                <td>{u.email}</td>
                <td>{fmtDate(u.createdAt)}</td>
                <td>{u.lastActive ? fmtDate(u.lastActive) : 'never'}</td>
                <td><span className="badge badge-amber">{issue(u)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn-primary sm" onClick={() => onCopy(rows)} disabled={!rows.length}>
          Copy {rows.length} Emails
        </button>
        {rows.length > 50 && <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>showing first 50 of {rows.length}</span>}
      </div>
    </div>
  )
}

function UserDetail({ user, events, onClose }: {
  user: AdminUserRow; events: AdminData['activity']['events']; onClose: () => void
}) {
  // Match on the display string the feed uses, falling back to email.
  const mine = events.filter((e) => e.user === user.name || e.user === user.email)
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal="true">
      <div className="modal wide">
        <div className="modal-header">
          <h2>{user.name ?? user.email}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{user.email}{user.phone ? ` · ${user.phone}` : ''}</span>
            <span>
              <span className="badge badge-muted">{user.role}</span>
              {user.emailVerified && <span className="badge badge-blue" style={{ marginLeft: 4 }}>verified</span>}
              {user.incomeVerified && <span className="badge badge-green" style={{ marginLeft: 4 }}>income</span>}
              {user.identityVerified && <span className="badge badge-green" style={{ marginLeft: 4 }}>identity</span>}
            </span>
          </div>

          <div className="user-profile-grid">
            <div><div className="user-pref-label">Budget</div><div className="user-pref-value">{fmtPrice(user.preferredMaxRent)}</div></div>
            <div><div className="user-pref-label">Bedrooms</div><div className="user-pref-value">{user.preferredBedrooms === null ? 'Not set' : user.preferredBedrooms === 0 ? 'Studio' : `${user.preferredBedrooms}BR`}</div></div>
            <div><div className="user-pref-label">City</div><div className="user-pref-value">{user.preferredCity ?? 'Not set'}</div></div>
            <div><div className="user-pref-label">Signed Up</div><div className="user-pref-value">{fmtDate(user.createdAt)}</div></div>
            <div><div className="user-pref-label">Last Active</div><div className="user-pref-value">{user.lastActive ? fmtDate(user.lastActive) : 'never'}</div></div>
            <div><div className="user-pref-label">Sessions</div><div className="user-pref-value">{user.sessions}</div></div>
            <div><div className="user-pref-label">Connections</div><div className="user-pref-value">{user.connections}</div></div>
            <div><div className="user-pref-label">Requests</div><div className="user-pref-value">{user.requests}</div></div>
            <div><div className="user-pref-label">Market</div><div className="user-pref-value">{user.market ?? 'unrecorded'}</div></div>
            <div><div className="user-pref-label">Verified Income</div><div className="user-pref-value">{user.verifiedIncomeCents ? fmtPrice(user.verifiedIncomeCents) + '/yr' : 'Not verified'}</div></div>
            <div><div className="user-pref-label">Readiness</div><div className="user-pref-value">{user.readiness ?? '--'}</div></div>
            <div><div className="user-pref-label">Signup Host</div><div className="user-pref-value">{user.signupHost ?? '--'}</div></div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
              Recent Activity
            </div>
            {mine.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No recent activity</div>
              : mine.map((e, i) => (
                <div className="activity-item" key={i} style={{ padding: '8px 0' }}>
                  <span className={`activity-dot ${e.type}`} />
                  <div>
                    <div className="activity-text">{e.detail}</div>
                    <div className="activity-time">{relTime(e.at)}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) } catch { return {} }
}

/** The originals stored a pre-flattened display string. Filters are structured
 *  here, so this renders them rather than storing prose. */
function describeFilters(f: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof f.beds === 'number') parts.push(f.beds === 0 ? 'Studio' : `${f.beds}BR`)
  if (typeof f.maxRent === 'number') parts.push(`under $${f.maxRent.toLocaleString()}`)
  if (typeof f.minRent === 'number') parts.push(`over $${f.minRent.toLocaleString()}`)
  if (Array.isArray(f.neighborhoods) && f.neighborhoods.length) parts.push((f.neighborhoods as string[]).join(', '))
  if (f.qualifiedOnly === true) parts.push('qualified only')
  if (f.connectedOnly === true) parts.push('connected only')
  if (f.hasQuery === true) parts.push('+ text search')
  return parts.length ? parts.join(' · ') : 'no filters'
}
