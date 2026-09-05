import { redirect } from 'next/navigation'
import { resolveAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Defence in depth — NOT the gate. Next renders layouts and pages in parallel,
 * and a crafted RSC request skips layouts altogether, so each page calls
 * requireAdminPage() itself. This exists so an unauthenticated browser
 * navigation redirects promptly rather than rendering a shell first.
 *
 * Only 'no_session' is passed through, and only so the denied page can offer a
 * sign-in link. Distinguishing "not an admin" from "not on the allowlist" would
 * tell an attacker which of the two gates they had already cleared.
 */
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const auth = await resolveAdmin()
  if (!auth.ok) redirect(auth.reason === 'no_session' ? '/denied?reason=no_session' : '/denied')
  return <>{children}</>
}
