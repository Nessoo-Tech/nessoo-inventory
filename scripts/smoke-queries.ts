/**
 * Runs every analytics and inventory READ the app performs, against a real
 * database, and prints what comes back.
 *
 * Two things this catches that a typecheck cannot: SQL that is syntactically
 * wrong or names a column that does not exist, and a query the
 * `nessoo_admin_app` role is not actually granted — run it with that credential
 * and a permission error surfaces here rather than on a live admin's screen.
 *
 *   DATABASE_URL=... npm run smoke
 *
 * Read-only. Writes nothing.
 */
import { getOverview } from '../lib/queries/overview'
import { listOrganizations, listUnits } from '../lib/queries/inventory'
import { db } from '../lib/db'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

let failed = false

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  process.stdout.write(`  ${label} … `)
  try {
    const out = await fn()
    console.log('ok')
    return out
  } catch (e) {
    failed = true
    const err = e as { code?: string; message: string }
    console.log('FAILED')
    console.error(`      ${err.code ? err.code + ': ' : ''}${err.message}`)
    return null
  }
}

async function main() {
  console.log('')
  const o = await run('getOverview(30)', () => getOverview(30))
  const orgs = await run('listOrganizations()', () => listOrganizations())
  await run('listUnits() unfiltered', () => listUnits())
  if (orgs?.length) await run('listUnits(orgId) filtered', () => listUnits(orgs[0].id))

  if (o) {
    console.log('\n  --- what the dashboard would show ---')
    console.log(`  signups total ......... ${o.signups.total}`)
    console.log(`  signups last 7d ....... ${o.signups.last7}`)
    console.log(`  signup series points .. ${o.signups.series.length}`)
    console.log(`  roles ................. ${o.signups.byRole.map((r) => `${r.role}:${r.count}`).join(' ')}`)
    console.log(`  markets ............... ${o.signups.byMarket.map((r) => `${r.market}:${r.count}`).join(' ')}`)
    console.log(`  active 7d / 30d ....... ${o.activity.activeLast7} / ${o.activity.activeLast30}`)
    console.log(`  renter profiles ....... ${o.verification.renterProfiles}`)
    console.log(`  ran Plaid income ...... ${o.verification.incomeVerified}`)
    console.log(`  ran Plaid identity .... ${o.verification.identityVerified}`)
    console.log(`  fully verified ........ ${o.verification.bothVerified}`)
    console.log(`  connections req/acc ... ${o.connections.requested} / ${o.connections.accepted}`)
    console.log(`  referral links ........ ${o.referrals.length}`)
    console.log(`  renter fees (cents) ... ${o.money.renterFeesCents} over ${o.money.renterFeeCount} payments`)
    console.log(`  org billing (cents) ... ${o.money.orgBillingCents}`)
    console.log(`  orgs/buildings/units .. ${o.inventory.orgs} / ${o.inventory.properties} / ${o.inventory.units}`)
    console.log(`  unit statuses ......... ${o.inventory.byStatus.map((r) => `${r.status}:${r.count}`).join(' ')}`)
    console.log('\n  --- caveats the UI surfaces ---')
    console.log(`  users with no profile . ${o.caveats.usersWithoutProfile}`)
    console.log(`  backfilled market ..... ${o.caveats.backfilledMarket}`)
    console.log(`  verification reset at . ${o.caveats.verificationResetAt ?? '(not found)'}`)
  }

  await db.end()
  console.log(failed ? '\n  ✗ some queries failed\n' : '\n  ✓ every query ran\n')
  process.exit(failed ? 1 : 0)
}

void main()
