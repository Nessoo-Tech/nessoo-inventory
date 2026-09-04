export const dynamic = 'force-dynamic'

export default function DeniedPage({
  searchParams,
}: {
  searchParams: { reason?: string }
}) {
  const reason = searchParams.reason

  // Deliberately vague to the visitor: this page must not confirm whether a
  // given account exists, holds super_admin, or is on the allowlist.
  const message =
    reason === 'no_session'
      ? 'You are not signed in.'
      : 'This account does not have access to the admin console.'

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 13, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>
          NESSOO ADMIN
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: '12px 0 8px' }}>Access denied</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          {message}
        </p>
        {reason === 'no_session' && (
          <p style={{ marginTop: 20, fontSize: 14 }}>
            <a href={process.env.SIGN_IN_URL ?? 'https://app.nessoo.com/sign-in'}>Sign in →</a>
          </p>
        )}
      </div>
    </main>
  )
}
