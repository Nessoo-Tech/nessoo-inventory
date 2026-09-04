import 'server-only'
import { headers } from 'next/headers'

/**
 * CSRF guard for state-changing requests.
 *
 * Once the session cookie's domain becomes `.nessoo.com`, the browser attaches
 * it to requests aimed at admin.nessoo.com that were *initiated* from any other
 * nessoo.com origin. SameSite=Lax does not help: it treats every *.nessoo.com
 * origin as same-site, so a compromised or malicious sibling subdomain could
 * drive production inventory writes using a real admin's live session.
 *
 * Stricter than homey-ux's assertTrustedOrigin(), which permits a request with
 * no Origin header because it guards mostly-GET routes that curl and
 * server-to-server callers legitimately hit. Everything guarded here is a
 * browser-issued POST/PATCH/DELETE, and browsers always send Origin on those —
 * so a missing Origin is itself suspicious and is rejected.
 */
export class OriginError extends Error {}

export function assertSameOrigin(): void {
  const h = headers()
  const host = h.get('host')
  if (!host) throw new OriginError('missing host')

  const origin = h.get('origin')
  if (!origin) throw new OriginError('missing origin')

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new OriginError('malformed origin')
  }

  if (originHost.toLowerCase() !== host.toLowerCase()) {
    throw new OriginError('cross-origin request rejected')
  }
}
