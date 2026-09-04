-- ============================================================
-- nessoo_admin_app — least-privilege Postgres role for admin.nessoo.com
--
-- Run this by hand against RDS with a privileged credential (homey_admin).
-- It is NOT part of homey-ux's numbered migration ledger, because it carries a
-- password and because roles are cluster-level, not schema-level.
--
-- Design rules, in order of importance:
--   1. No path to credentials. No grant on `session`, `account`, `verification`,
--      `application_tokens` or `org_invite_links` — each of those holds bearer
--      material. Session validation goes through validate_admin_session()
--      (migration 0027), which is SECURITY DEFINER, so this role gets EXECUTE
--      and never SELECT.
--   2. No path to regulated PII. renter_profiles is granted column-by-column,
--      excluding ssn_encrypted, dob_encrypted, credit_score, phone, address and
--      commute_destination.
--   3. Column-level grants wherever a table has any sensitive column, so that a
--      future ALTER TABLE ... ADD COLUMN is NOT automatically visible to this
--      role. Whole-table grants are used only where no column is sensitive.
--   4. No DELETE anywhere. properties and units both use soft-deletes
--      (deleted_at) throughout homey-ux; hard DELETE would silently diverge
--      from that convention and cascade.
--
-- Verify with: npm run verify:role  (scripts/verify-admin-role.mjs)
-- ============================================================

-- ---------- role ----------
-- Set the password from a secrets manager. Do not commit a real one.
CREATE ROLE nessoo_admin_app WITH LOGIN PASSWORD :'admin_app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 10;

-- CONNECT was revoked FROM PUBLIC on this database, so it must be granted back.
GRANT CONNECT ON DATABASE :"db_name" TO nessoo_admin_app;
GRANT USAGE ON SCHEMA public TO nessoo_admin_app;

-- ---------- auth ----------
GRANT EXECUTE ON FUNCTION validate_admin_session(TEXT) TO nessoo_admin_app;

-- ---------- reads: column-restricted (table has sensitive columns) ----------

-- excludes: image
GRANT SELECT (id, name, email, "emailVerified", "createdAt", "updatedAt", role)
  ON "user" TO nessoo_admin_app;

-- excludes: phone, stripe_customer_id, onboarding_answers (free-text PII)
GRANT SELECT (user_id, platform_role, onboarding_completed, onboarding_step,
              signup_host, signup_market, signup_market_backfilled,
              open_market_preview, created_at, updated_at)
  ON user_profiles TO nessoo_admin_app;

-- excludes: ssn_encrypted, dob_encrypted, credit_score, phone, address,
--           commute_destination, must_haves, disclosure, ui_prefs
GRANT SELECT (user_id, full_name, city, state, zip, visibility, household_id,
              identity_verified, income_verified, background_cleared, credit_checked,
              identity_verified_at, income_verified_at, background_verified_at,
              credit_checked_at, income_bootstrap_completed, income_bootstrap_completed_at,
              preferred_city, preferred_bedrooms, preferred_max_rent, preferred_min_rent,
              preferred_neighborhoods, move_in_window, shopping_scope, joined_exchange,
              employer, job_title, stated_income_cents, verified_income_cents,
              readiness_score, referred_by_link_id, created_at, updated_at)
  ON renter_profiles TO nessoo_admin_app;

-- excludes: stripe_customer_id
GRANT SELECT (id, name, slug, type, logo_url, website, billing_email, billing_name,
              is_model_b, default_criteria, created_at, updated_at, deleted_at)
  ON organizations TO nessoo_admin_app;

-- ---------- reads: whole-table (no sensitive columns) ----------
GRANT SELECT ON members              TO nessoo_admin_app;
GRANT SELECT ON properties           TO nessoo_admin_app;
GRANT SELECT ON units                TO nessoo_admin_app;
GRANT SELECT ON connection_requests  TO nessoo_admin_app;
GRANT SELECT ON connections          TO nessoo_admin_app;
GRANT SELECT ON referral_links       TO nessoo_admin_app;
GRANT SELECT ON renter_payments      TO nessoo_admin_app;
GRANT SELECT ON client_billing_events TO nessoo_admin_app;
GRANT SELECT ON subscriptions        TO nessoo_admin_app;
GRANT SELECT ON audit_events         TO nessoo_admin_app;
-- Migration ledger — lets the UI date the 0021 verification-timestamp reset,
-- so grandfathered rows can be labelled instead of silently misread.
GRANT SELECT ON _schema_applied      TO nessoo_admin_app;

-- ---------- writes: inventory only, insert/update only ----------
GRANT INSERT, UPDATE ON properties TO nessoo_admin_app;
GRANT INSERT, UPDATE ON units      TO nessoo_admin_app;

-- The admin app must be able to record what it did. Audit rows are
-- append-only by design: INSERT but never UPDATE or DELETE.
GRANT INSERT ON audit_events TO nessoo_admin_app;

-- ============================================================
-- MAINTENANCE NOTE
--
-- ALTER DEFAULT PRIVILEGES auto-grants future TABLES, never future COLUMNS on
-- an already-granted table. `members`, `properties`, `units`,
-- `connection_requests`, `connections`, `referral_links`, `renter_payments`,
-- `client_billing_events`, `subscriptions` and `audit_events` above are
-- whole-table grants — a migration that adds a sensitive column to any of them
-- exposes it to this role silently. Re-review this file whenever one of those
-- tables gains a column.
-- ============================================================
