# Deploying admin.nessoo.com

Already done (no action needed):

- Vercel project `nessoo-inventory` reconfigured: framework `nextjs`, Node 20.x,
  linked to `Nessoo-Tech/nessoo-inventory`, production branch `main`.
- `admin.nessoo.com` added to the project and verified.
- Preview deployments protected behind Vercel SSO.
- Env vars `ADMIN_ALLOWED_HOSTS` and `SIGN_IN_URL` set.

Five steps remain. Order matters: **1 → 5**. The app fails closed at every step,
so a half-finished setup denies access rather than granting it.

---

## 1. DNS

Add one record in Cloudflare, on the `nessoo.com` zone:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `admin` | `ad10a26d3a466cce.vercel-dns-017.com.` | **DNS only (grey cloud)** |

Grey cloud matters. An orange-clouded (proxied) record produces a Cloudflare 525
handshake error against Vercel — the same failure this project hit before on
`app.nessoo.com`.

Check: `nslookup admin.nessoo.com` resolves, and Vercel shows the domain as
configured rather than misconfigured.

## 2. Apply migration 0027

Creates `validate_admin_session()`, the shared function that defines what an
admin session is. Additive, and inert until someone actually holds `super_admin`.

```bash
cd homey-ux
node scripts/apply-0027-admin-session-validator.mjs
```

`npm run db:apply` will not work — it refuses while ten unrelated migrations are
flagged CHANGED (the known, deferred ledger issue). This script replicates that
tool's apply step exactly for this one file: same transaction, same checksum,
same ledger row.

Check: it prints `SECURITY DEFINER: true`, a pinned `search_path`, and `0 rows`
for a bogus token.

## 3. Create the database role

Generate a password and keep it in your secrets manager — it is the app's only
secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```bash
cd nessoo-inventory
ADMIN_DB_URL='postgres://homey_admin:...@<host>/homey' \
ADMIN_APP_PASSWORD='<the password>' \
node scripts/create-admin-role.mjs            # dry run first
# then re-run with --confirm
```

Then prove the restrictions actually hold:

```bash
DATABASE_URL='postgres://nessoo_admin_app:<password>@<host>/homey' \
npm run verify:role
```

This must print `✓ nessoo_admin_app privileges verified`. It asserts that reads
of session tokens, passwords, SSNs and DOBs all fail with permission denied, and
that no `DELETE` is possible anywhere. **If it fails, stop** — do not deploy a
credential whose limits are unproven.

## 4. Vercel env vars

Two more, on the `nessoo-inventory` project, production scope:

| Key | Value |
|---|---|
| `DATABASE_URL` | the `nessoo_admin_app` connection string from step 3 |
| `ADMIN_EMAIL_ALLOWLIST` | comma-separated admin emails, e.g. `a@nessoo.com,b@nessoo.com` |

Both fail closed: an empty allowlist admits nobody.

## 5. Grant the first super_admin

The person must already have signed up normally at app.nessoo.com — the script
never creates accounts.

```bash
cd homey-ux
node scripts/grant-super-admin.mjs someone@nessoo.com              # dry run
node scripts/grant-super-admin.mjs someone@nessoo.com --confirm
node scripts/grant-super-admin.mjs --list                          # who has it
```

Both gates must pass: `super_admin` in the database **and** the email in
`ADMIN_EMAIL_ALLOWLIST`. Setting only one of them grants nothing.

There is deliberately no UI for this. A feature that can mint admins is itself a
privilege-escalation target.

---

## The one risky change, deliberately last

Sessions are issued at `app.nessoo.com` with a host-only cookie, so
`admin.nessoo.com` cannot see them yet. Enabling that means setting the cookie
domain to `.nessoo.com` in `homey-ux/lib/auth.ts`:

```ts
advanced: {
  crossSubDomainCookies: { enabled: true, domain: '.nessoo.com' },
  cookies: { /* existing state-cookie override stays */ },
}
```

**This affects every user, not only admins.** Every signed-in user's session
cookie starts being sent to `admin.nessoo.com` and to any future `*.nessoo.com`
subdomain. `httpOnly` prevents JavaScript from reading it but does nothing about
a compromised subdomain server.

### The stale-cookie trap

Browsers keep host-only and domain cookies of the *same name* as separate
entries, and send both. After the flip, an existing visitor holds:

```
better-auth.session_token   host-only, app.nessoo.com   ← the old one, still there
better-auth.session_token   domain=.nessoo.com          ← the new one
```

Which one wins is ordering-dependent, and Better Auth's sign-out only clears the
cookie it now writes — the domain one. The host-only cookie can outlive a
sign-out and shadow the new session, which looks like "signing out did nothing"
or "I keep getting logged in as my old session".

Mitigation: on the deploy that flips this, also clear the old host-only cookie
once. In `middleware.ts`, when a request carries a host-only session cookie,
expire it explicitly:

```ts
res.cookies.set({
  name: '__Secure-better-auth.session_token',
  value: '', maxAge: 0, path: '/',      // NO domain → targets the host-only one
  secure: true, httpOnly: true, sameSite: 'lax',
})
```

Ship that alongside the flip, keep it for a couple of weeks, then remove it.
Without it, expect confusing sign-out reports rather than a clean cutover.

Do this only after steps 1–5 are verified, deploy it during a quiet window, and
confirm sign-in **and sign-out** still work on nessoo.com and app.nessoo.com
immediately after.

## Verifying end to end

1. A signed-out visitor to `admin.nessoo.com` → sent to sign in.
2. A signed-in **non-admin** → "access denied", and the page must not reveal
   whether the account exists or holds any role.
3. A signed-in **admin** → dashboard loads with real figures.
4. Sign out in the main app, then reload the admin console → access is refused
   immediately, with no caching delay.
5. Change a unit's status → the change persists **and** an `audit_events` row
   exists naming the actor:
   ```sql
   SELECT actor_id, action, object_type, object_id, created_at, metadata
   FROM audit_events WHERE metadata->>'surface' = 'admin.nessoo.com'
   ORDER BY created_at DESC LIMIT 10;
   ```
6. A preview deployment URL → blocked by Vercel SSO, and 404s even past it
   because the host is not in `ADMIN_ALLOWED_HOSTS`.

## Rolling back

Remove `DATABASE_URL` from the Vercel project, or run
`REVOKE CONNECT ON DATABASE homey FROM nessoo_admin_app;`. Either cuts the app
off instantly without touching the main product. Revoke a person's access with
`node scripts/grant-super-admin.mjs <email> --revoke --confirm`.
