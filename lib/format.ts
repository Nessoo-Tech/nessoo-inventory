// Formatters ported from the originals, with their quirks deliberately fixed
// rather than reproduced. Both dashboards had the same three helpers.

/** Original returned '--' for 0, which hid genuinely free/zero values. Kept,
 *  because the whole UI relies on '--' meaning "no price on file". */
export function fmtPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents === 0) return '--'
  return '$' + Math.round(cents / 100).toLocaleString()
}

/** For values already in whole dollars. */
export function fmtDollars(d: number | null | undefined): string {
  if (d === null || d === undefined || d === 0) return '--'
  return '$' + Math.round(d).toLocaleString()
}

/**
 * The original did `new Date('2026-08-15').toLocaleDateString()`, which parses a
 * bare ISO date as UTC midnight and then renders it in local time — showing the
 * previous day for anyone west of Greenwich. Date-only strings are pinned to UTC
 * here so the date shown is the date stored.
 */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '--'
  const dateOnly = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  const date = typeof d === 'string' ? new Date(dateOnly ? d + 'T00:00:00Z' : d) : d
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  })
}

export function bedsLabel(b: number | null | undefined): string {
  if (b === null || b === undefined) return '--'
  return b === 0 ? 'Studio' : `${b} bed`
}

/**
 * The original baked relative times into the data as literal strings ("2 min
 * ago"), so they were frozen at whatever the mock said. This computes them from
 * a real timestamp.
 */
export function relTime(d: string | Date | null | undefined): string {
  if (!d) return '--'
  const then = typeof d === 'string' ? new Date(d) : d
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return fmtDate(then)
}

export function daysSince(d: string | Date | null | undefined): number | null {
  if (!d) return null
  const then = typeof d === 'string' ? new Date(d) : d
  return Math.floor((Date.now() - then.getTime()) / 86_400_000)
}

export function pct(part: number, whole: number): string {
  if (!whole) return '0%'
  return Math.round((part / whole) * 100) + '%'
}

/** Shared chart palette, verbatim from the originals. */
export const CHART_COLORS = [
  '#4ade80', '#60a5fa', '#c9a84c', '#ef4444', '#22d3ee',
  '#a78bfa', '#fb923c', '#34d399', '#818cf8', '#fbbf24', '#94a3b8', '#f472b6',
]
