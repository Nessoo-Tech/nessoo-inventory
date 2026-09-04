#!/usr/bin/env node
/**
 * Creates the least-privilege `nessoo_admin_app` Postgres role and applies every
 * grant in sql/admin-role.sql. Idempotent — safe to re-run to re-apply grants
 * after a schema change.
 *
 * Run this with a PRIVILEGED credential (homey_admin), not the admin app's own.
 *
 *   ADMIN_DB_URL=postgres://homey_admin:...@host/db \
 *   ADMIN_APP_PASSWORD='<from your secrets manager>' \
 *   node scripts/create-admin-role.mjs --confirm
 *
 * Then put this into the Vercel project as DATABASE_URL:
 *   postgres://nessoo_admin_app:<password>@<host>:5432/<db>
 *   (no ?sslmode= — lib/db.ts supplies the TLS config, and sslmode in the
 *    URL makes pg-connection-string discard it, breaking verification)
 *
 * Verify afterwards with:  npm run verify:role
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const confirm = process.argv.includes('--confirm')
const url = process.env.ADMIN_DB_URL
const password = process.env.ADMIN_APP_PASSWORD

if (!url) {
  console.error('ADMIN_DB_URL is required (a privileged credential, e.g. homey_admin).')
  process.exit(1)
}
if (!password || password.length < 24) {
  console.error('ADMIN_APP_PASSWORD is required and must be at least 24 characters.')
  console.error('Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"')
  process.exit(1)
}

const db = new pg.Client({ connectionString: url, ssl: { ca: readFileSync(new URL('../certs/rds-global-bundle.pem', import.meta.url), 'utf8'), rejectUnauthorized: true } })
await db.connect()

const dbName = (await db.query('SELECT current_database() AS db')).rows[0].db
const roleExists = (await db.query(
  `SELECT 1 FROM pg_roles WHERE rolname = 'nessoo_admin_app'`)).rows.length > 0

// Column allowlists. Anything not named here is unreachable by the role, and a
// future ADD COLUMN stays unreachable until someone deliberately adds it.
const COLUMN_GRANTS = {
  '"user"': ['id', 'name', 'email', '"emailVerified"', '"createdAt"', '"updatedAt"', 'role'],
  // Daily-actives needs these timestamps. `token` is deliberately absent — it is
  // live bearer material, and a whole-table grant here would let the admin
  // console impersonate any user.
  session: ['"userId"', '"createdAt"', '"updatedAt"'],
  user_profiles: ['user_id', 'platform_role', 'onboarding_completed', 'onboarding_step',
    'signup_host', 'signup_market', 'signup_market_backfilled', 'open_market_preview',
    'created_at', 'updated_at'],
  renter_profiles: ['user_id', 'full_name', 'city', 'state', 'zip', 'visibility', 'household_id',
    'identity_verified', 'income_verified', 'background_cleared', 'credit_checked',
    'identity_verified_at', 'income_verified_at', 'background_verified_at', 'credit_checked_at',
    'income_bootstrap_completed', 'income_bootstrap_completed_at', 'preferred_city',
    'preferred_bedrooms', 'preferred_max_rent', 'preferred_min_rent', 'preferred_neighborhoods',
    'move_in_window', 'shopping_scope', 'joined_exchange', 'employer', 'job_title',
    'stated_income_cents', 'verified_income_cents', 'readiness_score', 'referred_by_link_id',
    'created_at', 'updated_at'],
  organizations: ['id', 'name', 'slug', 'type', 'logo_url', 'website',
    'is_model_b', 'created_at', 'updated_at', 'deleted_at'],

  // Every column the inventory screens read. landlord_name / landlord_email /
  // landlord_phone are deliberately absent: contact PII the console never
  // displays, and the previous whole-table grant also carried UPDATE rights to
  // rewrite them across every organization.
  units: ['id', 'org_id', 'property_id', 'name', 'bedrooms', 'bathrooms', 'rent_cents',
    'available_from', 'status', 'other_criteria', 'created_at', 'updated_at', 'deleted_at'],

  properties: ['id', 'org_id', 'name', 'address', 'city', 'state', 'zip', 'status',
    'created_at', 'updated_at', 'deleted_at'],

  // Counts and a daily series only. `message` is free text between a renter and
  // a broker and is none of this console's business.
  connection_requests: ['id', 'status', 'created_at', 'responded_at'],
  connections: ['id', 'accepted_at', 'created_at'],

  // Revenue totals only. Stripe identifiers are payment-system handles, excluded
  // for the same reason stripe_customer_id is excluded from user_profiles and
  // organizations above.
  renter_payments: ['id', 'payment_type', 'amount_cents', 'status', 'paid_at', 'refunded_at'],
  client_billing_events: ['id', 'org_id', 'event_type', 'amount_cents', 'status', 'created_at'],
  subscriptions: ['id', 'org_id', 'plan', 'status', 'period_start', 'period_end'],

  referral_links: ['id', 'code', 'label', 'use_count', 'expires_at', 'revoked_at', 'created_at'],

  // Only to date the 0021 verification-timestamp reset.
  schema_migrations: ['filename', 'applied_at'],
}

// Nothing gets a whole-table read any more. `members` was granted and never
// queried. `audit_events` keeps INSERT (below) but loses SELECT — this console
// writes the audit trail; it does not need to read back every actor's IP address
// and metadata blob platform-wide.
const TABLE_READS = []

const statements = []

// Only touch the role itself when it does not exist yet.
//
// Re-running this script is normally about re-applying GRANTs after a schema
// change, not about rotating the password. That distinction matters on RDS:
// CREATE ROLE ... NOSUPERUSER is fine for a CREATEROLE user, but
// ALTER ROLE ... NOSUPERUSER requires actual superuser and fails with
// "permission denied to alter role". Rotating is opt-in via --rotate-password.
const rotate = process.argv.includes('--rotate-password')

if (roleExists && !rotate) {
  console.log('  role already exists — leaving it alone, re-applying grants only')
  console.log('  (pass --rotate-password to also set a new password)\n')
} else if (roleExists) {
  statements.push({
    label: 'rotate password',
    // Password only. Any attribute flag here needs superuser on RDS.
    sql: `ALTER ROLE nessoo_admin_app WITH LOGIN PASSWORD ${literal(password)};`,
  })
} else {
  statements.push({
    label: 'create role',
    sql: `CREATE ROLE nessoo_admin_app WITH LOGIN PASSWORD ${literal(password)}
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;`,
  })
}

statements.push({ label: 'connect + schema', sql:
  `GRANT CONNECT ON DATABASE ${ident(dbName)} TO nessoo_admin_app;
   GRANT USAGE ON SCHEMA public TO nessoo_admin_app;` })

// Start from zero so a re-run can genuinely REMOVE a grant that was tightened.
statements.push({ label: 'revoke everything first', sql:
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nessoo_admin_app;
   REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM nessoo_admin_app;` })

statements.push({ label: 'session validator (EXECUTE only)', sql:
  `GRANT EXECUTE ON FUNCTION validate_admin_session(TEXT) TO nessoo_admin_app;` })

for (const [table, cols] of Object.entries(COLUMN_GRANTS)) {
  statements.push({
    label: `read ${table} (${cols.length} columns)`,
    sql: `GRANT SELECT (${cols.join(', ')}) ON ${table} TO nessoo_admin_app;`,
  })
}

if (TABLE_READS.length) {
  statements.push({ label: `read ${TABLE_READS.length} whole tables`, sql:
    TABLE_READS.map((t) => `GRANT SELECT ON ${t} TO nessoo_admin_app;`).join('\n') })
}

statements.push({ label: 'inventory writes (no DELETE)', sql:
  `GRANT INSERT, UPDATE ON properties TO nessoo_admin_app;
   GRANT INSERT, UPDATE ON units TO nessoo_admin_app;
   GRANT INSERT ON audit_events TO nessoo_admin_app;` })

function literal(s) { return `'${String(s).replace(/'/g, "''")}'` }
function ident(s) { return `"${String(s).replace(/"/g, '""')}"` }

console.log(`\n  database : ${dbName}`)
console.log(`  role     : nessoo_admin_app`)
console.log(`  steps    : ${statements.length}\n`)

if (!confirm) {
  for (const s of statements) console.log(`    would run: ${s.label}`)
  console.log('\n  DRY RUN — nothing changed. Re-run with --confirm to apply.\n')
  await db.end()
  process.exit(0)
}

try {
  await db.query('BEGIN')
  for (const s of statements) {
    process.stdout.write(`    ${s.label} … `)
    await db.query(s.sql)
    console.log('ok')
  }
  await db.query('COMMIT')
} catch (e) {
  await db.query('ROLLBACK').catch(() => {})
  console.error(`\n  ✗ FAILED — nothing was changed: ${e.message}\n`)
  await db.end()
  process.exit(1)
}

const host = new URL(url.replace(/^postgres(ql)?:\/\//, 'https://')).host
console.log('\n  ✓ role created and grants applied')
console.log('\n  Set this as DATABASE_URL on the Vercel project:')
console.log(`    postgres://nessoo_admin_app:<password>@${host}/${dbName}`)
console.log('    (deliberately no ?sslmode= — see the note at the top of this file)')
console.log('\n  Then verify the restrictions actually hold:')
console.log('    DATABASE_URL=<that url> npm run verify:role\n')

await db.end()
