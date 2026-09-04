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
 *   postgres://nessoo_admin_app:<password>@<host>:5432/<db>?sslmode=require
 *
 * Verify afterwards with:  npm run verify:role
 */
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

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

const dbName = (await db.query('SELECT current_database() AS db')).rows[0].db

// Column allowlists. Anything not named here is unreachable by the role, and a
// future ADD COLUMN stays unreachable until someone deliberately adds it.
const COLUMN_GRANTS = {
  '"user"': ['id', 'name', 'email', '"emailVerified"', '"createdAt"', '"updatedAt"', 'role'],
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
  organizations: ['id', 'name', 'slug', 'type', 'logo_url', 'website', 'billing_email',
    'billing_name', 'is_model_b', 'default_criteria', 'created_at', 'updated_at', 'deleted_at'],
}

// No sensitive columns on these, so a whole-table grant is honest and simpler.
const TABLE_READS = ['members', 'properties', 'units', 'connection_requests', 'connections',
  'referral_links', 'renter_payments', 'client_billing_events', 'subscriptions',
  'audit_events', '_schema_applied']

const statements = []

statements.push({
  label: 'create role',
  sql: `DO $do$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nessoo_admin_app') THEN
            ALTER ROLE nessoo_admin_app WITH LOGIN PASSWORD ${literal(password)}
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;
          ELSE
            CREATE ROLE nessoo_admin_app WITH LOGIN PASSWORD ${literal(password)}
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;
          END IF;
        END $do$;`,
})

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

statements.push({ label: `read ${TABLE_READS.length} whole tables`, sql:
  TABLE_READS.map((t) => `GRANT SELECT ON ${t} TO nessoo_admin_app;`).join('\n') })

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
console.log(`    postgres://nessoo_admin_app:<password>@${host}/${dbName}?sslmode=require`)
console.log('\n  Then verify the restrictions actually hold:')
console.log('    DATABASE_URL=<that url> npm run verify:role\n')

await db.end()
