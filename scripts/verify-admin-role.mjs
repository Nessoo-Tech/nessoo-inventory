#!/usr/bin/env node
// Asserts that the nessoo_admin_app role is actually as restricted as
// sql/admin-role.sql claims. Connects AS that role using DATABASE_URL, so it
// tests the real deployed credential, not an assumption about it.
//
// Postgres raises 42501 (insufficient_privilege) for a denied read. Anything
// else — including a query that unexpectedly SUCCEEDS — is a failure here.
//
// Run: npm run verify:role

import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (must be the nessoo_admin_app credential)')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 })

const failures = []

async function denied(label, sql) {
  try {
    await pool.query(sql)
    failures.push(`${label}: expected permission denied, but the query SUCCEEDED`)
  } catch (e) {
    if (e.code !== '42501') failures.push(`${label}: expected 42501, got ${e.code} — ${e.message}`)
  }
}

async function allowed(label, sql, params = []) {
  try {
    await pool.query(sql, params)
  } catch (e) {
    failures.push(`${label}: expected success, got ${e.code} — ${e.message}`)
  }
}

// --- credential material must be unreachable ---
await denied('session.token', 'SELECT token FROM session LIMIT 1')
await denied('session (any)', 'SELECT * FROM session LIMIT 1')
await denied('account.password', 'SELECT password FROM account LIMIT 1')
await denied('verification', 'SELECT * FROM verification LIMIT 1')
await denied('application_tokens', 'SELECT * FROM application_tokens LIMIT 1')
await denied('org_invite_links', 'SELECT * FROM org_invite_links LIMIT 1')

// --- regulated PII must be unreachable ---
await denied('renter_profiles.ssn_encrypted', 'SELECT ssn_encrypted FROM renter_profiles LIMIT 1')
await denied('renter_profiles.dob_encrypted', 'SELECT dob_encrypted FROM renter_profiles LIMIT 1')
await denied('renter_profiles.credit_score', 'SELECT credit_score FROM renter_profiles LIMIT 1')
await denied('renter_profiles.address', 'SELECT address FROM renter_profiles LIMIT 1')
await denied('renter_profiles (star)', 'SELECT * FROM renter_profiles LIMIT 1')
await denied('user_profiles.onboarding_answers', 'SELECT onboarding_answers FROM user_profiles LIMIT 1')

// --- no destructive writes anywhere ---
await denied('properties DELETE', "DELETE FROM properties WHERE id = '__nonexistent__'")
await denied('units DELETE', "DELETE FROM units WHERE id = '__nonexistent__'")
await denied('user UPDATE', `UPDATE "user" SET name = name WHERE id = '__nonexistent__'`)
await denied('user_profiles UPDATE', "UPDATE user_profiles SET platform_role = platform_role WHERE user_id = '__nonexistent__'")
await denied('audit_events UPDATE', "UPDATE audit_events SET action = action WHERE id = '__nonexistent__'")

// --- the app must still be able to do its job ---
await allowed('validate_admin_session EXECUTE', 'SELECT * FROM validate_admin_session($1)', ['__not-a-real-token__'])
await allowed('user read', 'SELECT id, email, "createdAt" FROM "user" LIMIT 1')
await allowed('renter_profiles allowed cols', 'SELECT user_id, income_verified_at FROM renter_profiles LIMIT 1')
await allowed('properties read', 'SELECT id, name FROM properties LIMIT 1')
await allowed('units read', 'SELECT id, rent_cents FROM units LIMIT 1')
await allowed('payments read', 'SELECT id, amount_cents FROM renter_payments LIMIT 1')

await pool.end()

if (failures.length) {
  console.error(`\n✗ ${failures.length} privilege check(s) failed:\n`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ nessoo_admin_app privileges verified')
