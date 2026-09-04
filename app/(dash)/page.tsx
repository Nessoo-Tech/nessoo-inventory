import { getOverview } from '@/lib/queries/overview'
import { Bars, Breakdown, Card, Caveat, Stat, StatGrid, usd } from './_ui'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const o = await getOverview(30)

  const verifiedPct = o.verification.renterProfiles
    ? Math.round((o.verification.bothVerified / o.verification.renterProfiles) * 100)
    : 0

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card title="Signups" hint="Counted from the auth table — every account that ever completed registration.">
        <StatGrid>
          <Stat label="Total" value={o.signups.total} />
          <Stat label="Last 7 days" value={o.signups.last7} />
          <Stat label="Last 30 days" value={o.signups.last30} />
        </StatGrid>
        <div style={{ marginTop: 20 }}>
          <Bars data={o.signups.series} />
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        <Card title="By role">
          <Breakdown rows={o.signups.byRole.map((r) => ({ label: r.role, count: r.count }))} />
        </Card>
        <Card title="By market">
          <Breakdown rows={o.signups.byMarket.map((r) => ({ label: r.market, count: r.count }))} />
          {(o.caveats.usersWithoutProfile > 0 || o.caveats.backfilledMarket > 0) && (
            <Caveat>
              {o.caveats.usersWithoutProfile.toLocaleString()} account
              {o.caveats.usersWithoutProfile === 1 ? ' has' : 's have'} no profile row at all — profiles
              are created lazily on a user&apos;s first authenticated action, so anyone who registered and
              never came back is counted in the total above but appears as{' '}
              <em>unrecorded</em> here.
              {o.caveats.backfilledMarket > 0 && (
                <>
                  {' '}
                  A further {o.caveats.backfilledMarket.toLocaleString()} had their market{' '}
                  <em>inferred</em> after the fact rather than recorded at signup.
                </>
              )}
            </Caveat>
          )}
        </Card>
      </div>

      <Card
        title="Sign-in activity"
        hint="Distinct users starting a session per day. This is the first thing on the platform to query the session table for analytics."
      >
        <StatGrid>
          <Stat label="Active, last 7d" value={o.activity.activeLast7} />
          <Stat label="Active, last 30d" value={o.activity.activeLast30} />
        </StatGrid>
        <div style={{ marginTop: 20 }}>
          <Bars data={o.activity.dau} color="var(--good)" />
        </div>
      </Card>

      <Card title="Verification — who ran Plaid" hint="Income is Plaid Income; identity is Plaid IDV. Bootstrap only creates the Plaid user, it does not run a report.">
        <StatGrid>
          <Stat label="Renter profiles" value={o.verification.renterProfiles} />
          <Stat label="Bootstrapped" value={o.verification.bootstrapped} />
          <Stat label="Income verified" value={o.verification.incomeVerified} />
          <Stat label="Identity verified" value={o.verification.identityVerified} />
          <Stat label="Fully verified" value={o.verification.bothVerified} sub={`${verifiedPct}% of profiles`} />
        </StatGrid>
        {o.caveats.verificationResetAt && (
          <Caveat>
            Verification timestamps recorded before{' '}
            {new Date(o.caveats.verificationResetAt).toLocaleDateString()} reflect a one-off
            grandfathering migration, not the date the renter actually verified. Counts above are
            reliable; per-renter dates before that point are not.
          </Caveat>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        <Card title="Connections" hint="Renter–broker connection requests and accepts.">
          <StatGrid>
            <Stat label="Requested" value={o.connections.requested} />
            <Stat
              label="Accepted"
              value={o.connections.accepted}
              sub={
                o.connections.requested
                  ? `${Math.round((o.connections.accepted / o.connections.requested) * 100)}% accept rate`
                  : undefined
              }
            />
          </StatGrid>
          <div style={{ marginTop: 20 }}>
            <Bars data={o.connections.series} />
          </div>
        </Card>

        <Card title="Inventory">
          <StatGrid>
            <Stat label="Organizations" value={o.inventory.orgs} />
            <Stat label="Buildings" value={o.inventory.properties} />
            <Stat label="Units" value={o.inventory.units} />
          </StatGrid>
          <div style={{ marginTop: 20 }}>
            <Breakdown rows={o.inventory.byStatus.map((r) => ({ label: r.status, count: r.count }))} />
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        <Card title="Money" hint="Charged by the verification service, which shares this database.">
          <StatGrid>
            <Stat
              label="Renter fees"
              value={usd(o.money.renterFeesCents)}
              sub={`${o.money.renterFeeCount.toLocaleString()} payments`}
            />
            <Stat label="Org billing" value={usd(o.money.orgBillingCents)} />
            <Stat label="Active subscriptions" value={o.money.activeSubscriptions} />
          </StatGrid>
        </Card>

        <Card title="Referral links" hint="Attribution is first-touch and set on signup; there is no click or impression tracking anywhere, so these cannot be compared to impression counts.">
          {o.referrals.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No active referral links.</p>
          ) : (
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Label</th>
                    <th>Signups</th>
                  </tr>
                </thead>
                <tbody>
                  {o.referrals.map((r) => (
                    <tr key={r.code}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{r.code}</td>
                      <td>{r.label ?? '—'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.attributed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
