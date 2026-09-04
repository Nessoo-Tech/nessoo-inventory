# Nessoo Admin

Internal platform console: analytics and inventory management, backed by the
real production database. Deployed to `admin.nessoo.com`.

Access is restricted to a handful of named people. There is no public surface.

## How access works

There is no separate login. You sign in at `app.nessoo.com` as normal, and this
app recognises that session. Four independent things must all be true:

1. **Host** — the request arrives on a host in `ADMIN_ALLOWED_HOSTS`. Anything
   else 404s in middleware, so a preview deployment is never a way in.
2. **Live session** — the Better Auth cookie resolves to an unexpired row in
   the `session` table.
3. **`platform_role = 'super_admin'`** — checked in Postgres, not here.
4. **Email allowlist** — `ADMIN_EMAIL_ALLOWLIST` in this deployment's env.

(2) and (3) are answered by a single SQL function, `validate_admin_session()`,
defined in `homey-ux/backend/schema/0027_admin_session_validator.sql`. That
function — not a copy of homey-ux's TypeScript — is the definition of "valid
admin session", which is what keeps two separate codebases from drifting apart
on what admin means. (4) is deliberately the one layer *not* stored in the
database, so a bug elsewhere that could write `platform_role` still isn't enough
to get in.

Consequence worth knowing: this app never verifies the cookie's signature and
therefore never holds `BETTER_AUTH_SECRET`. The session token is already a
high-entropy unique value; proving a live row exists is the real boundary.

## Secrets

Exactly one: `DATABASE_URL`, for the `nessoo_admin_app` Postgres role.

That role cannot read session tokens, passwords, OAuth tokens, invite tokens,
SSNs or dates of birth, and has no `DELETE` grant on anything. See
`sql/admin-role.sql` for the full grant list and the reasoning.

```bash
npm run verify:role   # asserts the restrictions actually hold, in CI
```

## Development

```bash
cp .env.example .env.local   # fill in DATABASE_URL and the allowlists
npm install
npm run dev
```

An empty `ADMIN_EMAIL_ALLOWLIST` or `ADMIN_ALLOWED_HOSTS` admits nobody — these
fail closed on purpose.

## What the numbers mean

Every figure is a real query against production. Nothing is mocked or
estimated. Where the data genuinely can't answer a question, the app says so
rather than showing a plausible number.

Three data-integrity caveats are surfaced in the UI next to the figures they
affect, because a reader who can't see them will draw the wrong conclusion:

- Profile rows are created lazily on a user's first authenticated action, so
  anyone who registered and never returned has no profile row at all. Total
  signups come from the auth table and are complete; segmented breakdowns
  undercount.
- Some `signup_market` values were inferred by a backfill rather than recorded
  at signup.
- A grandfathering migration reset verification timestamps, so per-renter
  verification *dates* before that migration are not real. The *counts* are.

Not built, because the data does not exist: search demand, listing views, AI and
vendor spend, "flagged" users, and system health. These need new instrumentation
(and, for flagged users, a product definition) — see the plan.

## Layout

```
app/(dash)/       gated pages — the auth check lives in this group's layout
app/api/          write endpoints; each one re-checks auth independently
lib/session.ts    THE auth boundary
lib/queries/      analytics and inventory SQL
sql/admin-role.sql  least-privilege DB role
legacy/           the old static dashboards; not served, not deployed
```
