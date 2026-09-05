/**
 * Runs every query the console makes, against a real database, and prints what
 * comes back.
 *
 * Two things this catches that a typecheck cannot: SQL that is syntactically
 * wrong or names a column that does not exist, and a query the
 * `nessoo_admin_app` role is not actually granted. Run it with THAT credential
 * — running it as a privileged role is how a missing grant on `session` reached
 * production once already.
 *
 *   DATABASE_URL=<nessoo_admin_app url> npm run smoke
 *
 * Read-only. Writes nothing.
 */
import { getAdminData } from '../lib/queries/admin'
import { listUsers, flagUsers } from '../lib/queries/users'
import { getInventoryData } from '../lib/queries/inventory-data'
import { listOrganizations, listUnits } from '../lib/queries/inventory'
import { db } from '../lib/db'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

let failed = false

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  process.stdout.write(`  ${label.padEnd(34)} `)
  const t = Date.now()
  try {
    const out = await fn()
    console.log(`ok  ${Date.now() - t}ms`)
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
  const admin = await run('getAdminData(14)', () => getAdminData(14))
  const users = await run('listUsers()', () => listUsers())
  const inv = await run('getInventoryData()', () => getInventoryData())
  await run('listOrganizations()', () => listOrganizations())
  await run('listUnits()', () => listUnits())

  if (admin) {
    console.log('\n  --- admin console ---')
    console.log(`  activity events ....... ${admin.activity.events.length}`)
    console.log(`  signups ............... ${admin.analytics.totalSignups}  growth ${admin.analytics.monthlyGrowthPct}%  retention ${admin.analytics.retention7dPct}%`)
    console.log(`  funnel ................ ${admin.analytics.funnel.signedUp} → ${admin.analytics.funnel.completedProfile} → ${admin.analytics.funnel.firstConnection}`)
    console.log(`  searches .............. ${admin.searches.total} (${admin.searches.noResultsRatePct}% zero-result)`)
    console.log(`  listing perf .......... top ${admin.listings.top.length}, dead ${admin.listings.dead.length}, no activity ${admin.listings.noActivityCount}`)
    console.log(`  system ................ ${admin.system.dbSize}, ${admin.system.migrationsApplied} migrations, ${admin.system.apiCalls24h} AI calls/24h`)
    console.log(`  revenue ............... ${admin.revenue.renterFeesCents}c over ${admin.revenue.renterFeeCount} payments`)
  }
  if (users) {
    const f = flagUsers(users)
    console.log('\n  --- users ---')
    console.log(`  total ................. ${users.length}  with phone ${users.filter((u) => u.phone).length}`)
    console.log(`  flagged ............... neverReturned ${f.neverReturned.length}, quiet ${f.wentQuiet.length}, stalled ${f.startedNotFinishedVerification.length}`)
  }
  if (inv) {
    console.log('\n  --- inventory console ---')
    console.log(`  clients ............... ${inv.clients.length}`)
    console.log(`  listings .............. ${inv.listings.length}`)
    console.log(`  prospects ............. ${inv.prospects.length}`)
  }

  await db.end()
  console.log(failed ? '\n  ✗ some queries failed\n' : '\n  ✓ every query ran\n')
  process.exit(failed ? 1 : 0)
}

void main()
