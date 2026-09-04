import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedHost } from './lib/allowlist'

// Defense in depth only — NOT the auth boundary. Real session validation and
// the super_admin check happen server-side in lib/session.ts, which every page
// and API route goes through. This layer does two things middleware is
// genuinely good at: refusing unexpected hosts outright, and stamping a
// per-request CSP nonce.

export function middleware(req: NextRequest) {
  // An unauthenticated copy of this app sitting on a *.vercel.app preview URL
  // is a real leak vector that no session check would ever see. 404, don't
  // redirect — a redirect confirms the app exists here.
  if (!isAllowedHost(req.headers.get('host'))) {
    return new NextResponse('Not found', { status: 404 })
  }

  const nonce = crypto.randomUUID().replace(/-/g, '')
  const isProd = process.env.NODE_ENV === 'production'

  // Injected JS can't read the httpOnly session cookie, but it CAN ride a live
  // admin session to call every write endpoint the admin is authorized for.
  // Hence strict-dynamic + nonce in production, and no CDN dependency anywhere
  // (charts are bundled from npm, not loaded from jsdelivr).
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-inline' 'unsafe-eval'`

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ')

  // Next reads the CSP off the REQUEST headers to apply the nonce to its own
  // bootstrap scripts; the response header is what the browser enforces.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('Content-Security-Policy', csp)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
