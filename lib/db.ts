import 'server-only'
import { Pool } from 'pg'

// One pool per process, same RDS-safe settings homey-ux uses in backend/db.ts.
// The connection string here belongs to the least-privilege `nessoo_admin_app`
// role — it cannot read session tokens, passwords, SSNs or DOBs directly, and
// can only write to `properties` and `units`. See sql/admin-role.sql.

const globalForDb = globalThis as unknown as { adminPool?: Pool }

export const db =
  globalForDb.adminPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  })

if (process.env.NODE_ENV !== 'production') globalForDb.adminPool = db
