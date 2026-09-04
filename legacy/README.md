# Legacy — do not deploy

These are the original "vibecoded" static dashboards, kept only as a design
reference and as the source of truth for the one-time Supabase → RDS migration.

**They were moved out of `public/` deliberately.** Next.js serves everything in
`public/` as a static file with no auth, so leaving `dashboard.html` there would
have published an unauthenticated, credential-bearing page at
`admin.nessoo.com/dashboard.html` — straight past the session gate that the rest
of this app is built around.

## Known problems with these files

- `dashboard.html` hardcodes a live Supabase anon key in client JS, and
  `003_renters.sql` grants the anonymous role full read/write on the `renters`
  table (real names, emails, phones). Anyone who viewed source could read or
  delete that list. Rotate the key and fix the RLS policies in the Supabase
  console — that is independent of this rebuild and should already be done.
- The same key is embedded in both Google Apps Script files.
- `admin-dashboard.html` is entirely mock data. `API_BASE` is never declared, so
  setting `USE_MOCK = false` does not connect it to anything — it white-screens.
- Neither file has any concept of a logged-in user.

## Retirement

The Google Sheets sync is being retired outright: inventory moves into RDS and
is managed through the authenticated app in this repo. Delete this directory
once the migration has been verified and burned in.
