// Shapes and display copy shared between the server queries in
// queries/gaps.ts and the client components that render them.
//
// Split out deliberately: gaps.ts imports `server-only`, so a client component
// importing ISSUE_COPY from there would drag the database module into the
// browser bundle. The guard caught exactly that.

export interface GapRow {
  neighborhood: string | null
  bedrooms: number | null
  budgetLowCents: number | null
  budgetHighCents: number | null
  renters: number
  /** Cheapest active unit matching neighborhood + beds, at any price. The gap
   *  between this and budgetHigh is how far off the market they are. */
  cheapestCents: number | null
  /** Units matching neighborhood + beds but priced above what they can pay.
   *  A near miss is a repricing conversation, not an acquisition one. */
  nearMisses: number
  /** Units matching neighborhood + beds at any price. */
  supplyInArea: number
}

export interface ZeroResultRow {
  filters: Record<string, unknown>
  times: number
  lastAt: string
}

export interface GapReport {
  totalWithPreferences: number
  unservedRenters: number
  gaps: GapRow[]
  zeroResults: ZeroResultRow[]
  /** Neighborhoods renters want, ranked by how many have zero options there. */
  hotspots: { neighborhood: string; unserved: number; supply: number }[]
}

export type HealthIssue =
  | 'no_neighborhood' | 'no_price' | 'no_available_date' | 'no_bedrooms'
  | 'stale' | 'no_interest'

export interface HealthRow {
  unitId: string
  orgId: string
  clientName: string
  address: string
  unit: string
  neighborhood: string | null
  rentCents: number | null
  bedrooms: number | null
  availableFrom: string | null
  daysListed: number
  views: number
  requests: number
  issues: HealthIssue[]
}

export interface HealthReport {
  rows: HealthRow[]
  counts: Record<HealthIssue, number>
  totalActive: number
  cleanCount: number
  byClient: { orgId: string; clientName: string; units: number; withIssues: number }[]
}

/** Every check maps to a concrete consequence, not a score for its own sake. */
export const ISSUE_COPY: Record<HealthIssue, { label: string; why: string; severity: 'high' | 'medium' | 'low' }> = {
  no_neighborhood: { label: 'No neighborhood', why: 'Invisible to neighborhood search and to every /nyc page.', severity: 'high' },
  no_price: { label: 'No price', why: 'Skipped by every budget filter a renter applies.', severity: 'high' },
  no_bedrooms: { label: 'No bedroom count', why: 'Skipped by every bedroom filter.', severity: 'high' },
  no_available_date: { label: 'No availability date', why: 'Cannot be matched to a renter’s move-in window.', severity: 'medium' },
  stale: { label: 'Listed 60+ days', why: 'Long on market — worth a price or photo review.', severity: 'medium' },
  no_interest: { label: 'No views or requests', why: 'Live but nobody has engaged. Note view tracking only began 4 Sep 2026.', severity: 'low' },
}
