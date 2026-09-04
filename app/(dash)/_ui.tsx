import type { CSSProperties, ReactNode } from 'react'

// Server-rendered presentation only. Charts are CSS bars rather than a charting
// library on purpose: no client JS in the render path means the strict CSP in
// middleware.ts stays strict, and there is no third-party script anywhere near
// a page that displays real user data.

export function Card({
  title,
  hint,
  children,
  style,
}: {
  title?: string
  hint?: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 16,
        ...style,
      }}
    >
      {title && (
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 500, margin: 0, color: 'var(--text)' }}>{title}</h2>
          {hint && (
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 0 0', lineHeight: 1.5 }}>
              {hint}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 500, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20 }}>
      {children}
    </div>
  )
}

export function Bars({ data, color = 'var(--brand)' }: { data: { day: string; count: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="scroll-x">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96, minWidth: data.length * 8 }}>
        {data.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.count}`}
            style={{
              flex: 1,
              minWidth: 6,
              height: `${Math.max(2, (d.count / max) * 100)}%`,
              background: d.count === 0 ? 'var(--border)' : color,
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-faint)' }}>
        <span>{data[0]?.day}</span>
        <span>peak {max.toLocaleString()}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  )
}

export function Breakdown({ rows }: { rows: { label: string; count: number }[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--text-dim)' }}>{r.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.count.toLocaleString()}</span>
          </div>
          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${(r.count / total) * 100}%`, height: '100%', background: 'var(--brand)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Data-integrity disclaimer rendered next to the numbers it affects, not buried
 * in a doc. Several of these figures are undercounts or have known resets in
 * their history; a reader who can't see that will draw wrong conclusions.
 */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 11,
        lineHeight: 1.6,
        color: 'var(--warn)',
        background: 'rgba(251, 191, 36, 0.07)',
        border: '1px solid rgba(251, 191, 36, 0.2)',
        borderRadius: 6,
        padding: '8px 10px',
        margin: '12px 0 0',
      }}
    >
      {children}
    </p>
  )
}

export function usd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
