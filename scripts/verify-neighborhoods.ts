// npm run verify:neighborhoods
//
// Two jobs, because the neighborhood string is load-bearing in a way nothing
// reports on: homey-ux looks it up with `n.name === name`, an exact compare, so
// a name that differs by one character has no public /nyc page and no sitemap
// URL — and no error anywhere says so.
//
//   1. The resolver still snaps the variants people actually type onto the
//      canonical spelling. Now that the field takes free text, "SoHo" and
//      "Soho" becoming two neighborhoods is a live risk, not a hypothetical.
//   2. What is actually stored in the database, and which of those names are
//      outside the canonical list — the drift report. Run it after adding
//      neighborhoods to homey-ux's gazetteer to see what is now reachable.
//
// Exits non-zero only on a resolver failure. Drift is reported, not failed:
// a genuinely new neighborhood with no public page yet is a normal state.

import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { resolveNeighborhood, CANONICAL_NAMES } from '../lib/neighborhoods'

let bad = 0
function eq(input: string, wantName: string, wantCanonical: boolean) {
  const r = resolveNeighborhood(input)
  const okName = r?.name === wantName
  const okCanon = !!r?.canonical === wantCanonical
  if (!okName || !okCanon) {
    bad++
    console.log(`  FAIL  ${JSON.stringify(input)} -> ${JSON.stringify(r?.name)} canonical=${r?.canonical}`)
    console.log(`        wanted ${JSON.stringify(wantName)} canonical=${wantCanonical}`)
  } else {
    console.log(`  ok    ${JSON.stringify(input).padEnd(26)} -> ${JSON.stringify(r!.name)}${r!.snappedFrom ? ' (snapped)' : ''}`)
  }
}

console.log(`\n  RESOLVER — ${CANONICAL_NAMES.length} canonical names\n`)
// Canonical spells these without apostrophes, dots, or camel case. Typing the
// natural form must not create a second neighborhood.
eq('SoHo', 'Soho', true)
eq('NoHo', 'Noho', true)
eq('NoLita', 'Nolita', true)
eq("Hell's Kitchen", 'Hells Kitchen', true)
eq('hells kitchen', 'Hells Kitchen', true)
eq('St George', 'St. George', true)
// Local shorthand.
eq('Bed-Stuy', 'Bedford-Stuyvesant', true)
eq('Bedford Stuyvesant', 'Bedford-Stuyvesant', true)
eq('LIC', 'Long Island City', true)
eq('FiDi', 'Financial District', true)
eq('UWS', 'Upper West Side', true)
// Clinton is an old name for Hells Kitchen; Clinton Hill is a different place
// in another borough and must survive untouched.
eq('Clinton / Hells Kitchen', 'Hells Kitchen', true)
eq('Clinton Hill', 'Clinton Hill', true)
// Genuinely new names pass through as typed — that is the feature. DUMBO is the
// case worth naming: it is real, absent from the gazetteer, and must NOT be
// bent onto Downtown Brooklyn to buy it a page.
eq('DUMBO', 'DUMBO', false)
eq('Ridgewood Heights', 'Ridgewood Heights', false)
eq('  Spaced   Out  ', 'Spaced Out', false)
if (resolveNeighborhood('   ') !== null) { bad++; console.log('  FAIL  blank should resolve to null') }
else console.log('  ok    blank -> null')

async function drift() {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
    }
  } catch { /* no local env — resolver checks above still ran */ }
  const url = process.env.DATABASE_URL || env.DATABASE_URL
  if (!url) { console.log('\n  DRIFT — skipped, no DATABASE_URL\n'); return }

  // Verified TLS against Amazon's pinned RDS CA, like lib/db.ts and
  // verify-admin-role.mjs. `rejectUnauthorized: false` would make this the one
  // connection in the repo open to an impostor, for a read-only drift report.
  const c = new Client({
    connectionString: url,
    ssl: {
      ca: readFileSync(new URL('../certs/rds-global-bundle.pem', import.meta.url), 'utf8'),
      rejectUnauthorized: true,
    },
  })
  await c.connect()
  const { rows } = await c.query(`
    SELECT other_criteria->>'neighborhood' AS nb, count(*)::int AS units
      FROM units
     WHERE deleted_at IS NULL AND status = 'active'
       AND coalesce(other_criteria->>'neighborhood','') <> ''
     GROUP BY 1 ORDER BY units DESC`)
  const missing = (await c.query(`
    SELECT count(*)::int AS n FROM units
     WHERE deleted_at IS NULL AND status = 'active'
       AND coalesce(other_criteria->>'neighborhood','') = ''`)).rows[0].n
  await c.end()

  const off = rows.filter(r => !CANONICAL_NAMES.includes(r.nb))
  console.log(`\n  DRIFT — ${rows.length} neighborhoods in use, ${missing} active units with none`)
  if (!off.length) {
    console.log('    every name in use is canonical')
  } else {
    console.log(`    ${off.length} in use with NO public /nyc page:`)
    for (const r of off) {
      const snap = resolveNeighborhood(r.nb)
      const hint = snap?.canonical ? `  -> would now snap to "${snap.name}"` : ''
      console.log(`      ${String(r.units).padStart(4)} units  "${r.nb}"${hint}`)
    }
    console.log('    Add them to homey-ux lib/geo/nyc-neighborhoods.ts, then re-sync lib/neighborhoods.ts.')
  }
}

drift()
  .catch(e => { console.log(`\n  DRIFT — skipped: ${e.message}`) })
  .finally(() => {
    console.log(`\n  ${bad === 0 ? 'resolver OK' : `${bad} RESOLVER FAILURES`}\n`)
    process.exit(bad === 0 ? 0 : 1)
  })
