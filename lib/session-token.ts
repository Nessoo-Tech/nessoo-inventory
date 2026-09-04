// Deliberately free of any Next.js or database import so it can be unit-tested
// directly. This is the only piece of Better Auth's cookie format this app
// reproduces, so it is also the one place a Better Auth upgrade could silently
// break us — hence its own module and its own test.
//
// Derived from better-auth's setSignedCookie (cookies/index.mjs): the cookie is
// `encodeURIComponent(rawToken + "." + base64(HMAC-SHA256(rawToken, secret)))`,
// where rawToken is exactly `session.token` in Postgres.

export function extractSessionToken(raw: string | null | undefined): string | null {
  if (!raw) return null

  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    // Already decoded, or malformed encoding — carry on with the raw value.
  }

  // Base64 output never contains ".", so the LAST "." is always the separator
  // between token and signature. Splitting wrong just fails the database
  // lookup downstream, which fails closed rather than open.
  const lastDot = value.lastIndexOf('.')
  if (lastDot <= 0) return null

  const token = value.slice(0, lastDot)
  return token.length > 0 ? token : null
}
