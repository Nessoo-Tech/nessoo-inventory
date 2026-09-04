import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

// One pool per process. The connection string here belongs to the
// least-privilege `nessoo_admin_app` role — it cannot read session tokens,
// passwords, SSNs or DOBs, and can only write to `properties` and `units`.
// See sql/admin-role.sql.
//
// TLS: this connection carries production PII and the role password, so the
// server certificate is actually VERIFIED against Amazon's published RDS CA
// bundle rather than blindly accepted. homey-ux uses
// `rejectUnauthorized: false` here, which leaves the connection open to an
// active man-in-the-middle; that is worth fixing there too, but this app is new
// so it starts correct. The bundle is committed at certs/rds-global-bundle.pem
// (public, non-secret) — a filesystem read is used rather than an import so the
// PEM is not inlined into the client bundle.

const globalForDb = globalThis as unknown as { adminPool?: Pool }

function rdsCa(): string | undefined {
  try {
    return readFileSync(join(process.cwd(), 'certs', 'rds-global-bundle.pem'), 'utf8')
  } catch {
    // Deliberately not falling back to an unverified connection: if the bundle
    // is missing the deployment is broken, and failing loudly is safer than
    // silently downgrading every future connection's security.
    throw new Error(
      'certs/rds-global-bundle.pem is missing — refusing to connect without certificate verification',
    )
  }
}

export const db =
  globalForDb.adminPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { ca: rdsCa(), rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  })

if (process.env.NODE_ENV !== 'production') globalForDb.adminPool = db
