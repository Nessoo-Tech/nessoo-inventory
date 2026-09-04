import { redirect } from 'next/navigation'
import { resolveAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/inventory', label: 'Inventory' },
]

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  // Defence in depth and the shell's own data — NOT the gate. Next renders
  // layouts and pages in parallel, and a crafted RSC request skips layouts
  // altogether, so each page calls requireAdminPage() itself. See lib/session.ts.
  //
  // Only 'no_session' is passed through, and only so the denied page can offer a
  // sign-in link. Distinguishing "not an admin" from "not on the allowlist"
  // would tell an attacker which of the two gates they already cleared.
  const auth = await resolveAdmin()
  if (!auth.ok) redirect(auth.reason === 'no_session' ? '/denied?reason=no_session' : '/denied')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '0 20px',
          height: 52,
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--text-faint)' }}>
          NESSOO ADMIN
        </span>
        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                color: 'var(--text-dim)',
                fontSize: 13,
                padding: '6px 10px',
                borderRadius: 6,
                textDecoration: 'none',
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{auth.user.email}</span>
      </header>
      <main style={{ flex: 1, padding: 24, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  )
}
