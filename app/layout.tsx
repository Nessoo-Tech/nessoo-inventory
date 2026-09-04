import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nessoo Admin',
  description: 'Internal platform analytics and inventory management',
  robots: { index: false, follow: false, nocache: true },
}

// Real user data on every page — never prerender, never cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
