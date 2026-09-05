import type { Metadata } from 'next'
import { DM_Sans, DM_Serif_Display } from 'next/font/google'
import './globals.css'

// The two typefaces the original dashboards used: DM Serif Display for every
// number and heading, DM Sans for everything else.
//
// Loaded through next/font rather than a <link> to Google Fonts. It self-hosts
// them at build time, which matters more here than convenience: it removes a
// third-party request from a page rendering real user data, lets the CSP stay
// closed to fonts.googleapis.com / fonts.gstatic.com, and avoids the flash of
// fallback text while the stylesheet round-trips.
const sans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-dm-sans',
  display: 'swap',
})
const serif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Nessoo · Admin',
  description: 'Internal platform analytics and inventory management',
  robots: { index: false, follow: false, nocache: true },
}

// Real user data on every page — never prerender, never cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
