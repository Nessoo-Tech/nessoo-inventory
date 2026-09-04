/**
 * Drift detector.
 *
 * This app's entire notion of "who is an admin" is delegated to one SQL
 * function that lives in a DIFFERENT repository (homey-ux, migration 0027).
 * That is what stops two codebases maintaining two subtly different definitions
 * of admin — but it also means a change over there can silently reshape the gate
 * over here. This asserts the contract still holds, and fails loudly in THIS
 * repo's CI if it does not.
 *
 * Run: npm run verify:session
 */
import pg from 'pg'
import { extractSessionToken } from '../lib/session-token'

const failures: string[] = []
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${detail ? ' — ' + detail : ''}`)
  if (!pass) failures.push(label)
}

function checkCookieParsing() {
  const rawToken = 'abc123XYZ_token'
  const signed = `${rawToken}.c2lnbmF0dXJlLWJhc2U2NA==`

  check('splits a signed cookie at the last dot', extractSessionToken(signed) === rawToken)
  check('handles a URL-encoded cookie', extractSessionToken(encodeURIComponent(signed)) === rawToken)
  check('rejects empty input', extractSessionToken('') === null && extractSessionToken(null) === null)
  check('rejects a value with no signature', extractSessionToken('nodothere') === null)
  check('rejects a leading-dot value', extractSessionToken('.sig') === null)
  // A token containing dots must keep every dot except the last.
  check('keeps dots inside the token', extractSessionToken('a.b.c.SIG') === 'a.b.c')
}

async function checkSqlContract(url: string) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()

  try {
    const def = await c.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname = 'validate_admin_session' AND n.nspname = 'public'`,
    )

    check('validate_admin_session exists', def.rows.length === 1, `found ${def.rows.length}`)

    if (def.rows.length !== 1) {
      // Nothing else is meaningful until migration 0027 has been applied.
      return
    }

    {
      const src = def.rows[0].src
      // If any of these disappear, the gate has widened without this repo
      // knowing — precisely the drift this file exists to catch.
      check("still filters on platform_role = 'super_admin'", /super_admin/.test(src))
      check('still rejects expired sessions', /expiresAt/.test(src) && /NOW\(\)/.test(src))
      check(
        'still runs SECURITY DEFINER with a pinned search_path',
        /SECURITY DEFINER/i.test(src) && /search_path/i.test(src),
      )
    }

    const bogus = await c.query('SELECT * FROM validate_admin_session($1)', ['not-a-real-token'])
    check('a bogus token resolves to nobody', bogus.rows.length === 0, `got ${bogus.rows.length} rows`)
    check(
      'returns the four columns this app reads',
      ['user_id', 'email', 'name', 'platform_role'].every((f) =>
        bogus.fields.some((col) => col.name === f),
      ),
      bogus.fields.map((f) => f.name).join(', '),
    )
  } finally {
    await c.end()
  }
}

async function main() {
  checkCookieParsing()

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('\nDATABASE_URL is not set — cannot verify the SQL contract.')
    process.exit(1)
  }
  await checkSqlContract(url)

  if (failures.length) {
    console.error(`\n✗ ${failures.length} contract check(s) failed`)
    process.exit(1)
  }
  console.log('\n✓ admin session contract verified')
}

void main()
