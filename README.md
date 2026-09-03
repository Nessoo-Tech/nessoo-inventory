# Nessoo Inventory & Admin Dashboards

## Inventory Dashboard (`public/dashboard.html`)
Internal dashboard for managing all rental listings across clients. Syncs with Google Sheets for data entry.

- **Supabase Project:** `xwwvlydkdjdxchgsksjv`
- **Live URL:** https://nessoo-deploy.vercel.app

### Key Files
- `public/dashboard.html` — Inventory dashboard (listings, search, renters, leased, analytics)
- `google-apps-script.js` — Google Sheets sync script for listings
- `google-apps-script-renters.js` — Google Sheets sync script for renters
- `supabase/migrations/002_rental_dashboard.sql` — Listings database schema
- `supabase/migrations/003_renters.sql` — Renters database schema

## Admin Dashboard (`public/admin-dashboard.html`)
Platform admin dashboard for monitoring user signups, activity, search demand, and listing performance. Connects to AWS backend.

- **Live URL:** https://nessoo-deploy.vercel.app/admin.html

### Key Files
- `public/admin-dashboard.html` — Admin dashboard (users, activity, analytics, flagged, search demand, listings, system, revenue)
- Currently using mock data. Set `USE_MOCK = false` and configure API endpoints to connect to AWS.
