import type { ListingRow } from '@/lib/queries/inventory-data'
import { bedsLabel, fmtPrice } from '@/lib/format'

// The original dashboard's natural-language search, ported with its semantics
// intact — and one real bug fixed.

export const NHOODS = [
  'East Harlem', 'Harlem', 'Washington Heights', 'Inwood', 'South Bronx', 'Morrisania',
  'Fordham', 'Highbridge', 'East New York', 'Brownsville', 'Bed-Stuy', 'Crown Heights',
  'Flatbush', 'Bushwick', 'Williamsburg', 'Jamaica', 'Far Rockaway', 'Astoria',
  'Long Island City', 'Upper West Side', 'Upper East Side', 'Midtown', 'Chelsea',
  'Lower East Side', 'Financial District', 'Park Slope', 'Bay Ridge', 'Sunset Park',
  'Flushing', 'Jackson Heights',
]
export const BOROS = ['Manhattan', 'Brooklyn', 'Bronx', 'Queens', 'Staten Island']
const FEATURE_WORDS = ['laundry', 'elevator', 'doorman', 'pets', 'parking', 'gym',
  'rooftop', 'balcony', 'dishwasher', 'renovated', 'furnished']

export interface ParsedQuery {
  bedrooms?: number
  priceMax?: number
  priceMin?: number
  neighborhood?: string
  clientId?: string
  status?: string
  features: string[]
  /** True when the parser recognised nothing — the caller then falls back to a
   *  plain substring match. The original computed this wrong: it always set a
   *  (possibly empty) features array, so its own free-text branch was
   *  unreachable and a query like "Broadway" silently returned everything. */
  recognisedNothing: boolean
}

export function parseNL(query: string, clients: { id: string; name: string }[]): ParsedQuery {
  const q = query.toLowerCase()
  const f: ParsedQuery = { features: [], recognisedNothing: true }

  const bed = q.match(/(\d+)\s*(?:br|bed|bedroom|bdr)/i)
  if (bed) f.bedrooms = parseInt(bed[1], 10)
  if (/studio/i.test(q)) f.bedrooms = 0

  const under = q.match(/(?:under|below|less than|<|max)\s*\$?([\d,]+)/i)
  if (under) f.priceMax = parseInt(under[1].replace(/,/g, ''), 10)
  const over = q.match(/(?:over|above|more than|>|min)\s*\$?([\d,]+)/i)
  if (over) f.priceMin = parseInt(over[1].replace(/,/g, ''), 10)

  for (const nb of NHOODS) if (q.includes(nb.toLowerCase())) { f.neighborhood = nb; break }
  for (const c of clients) if (c.name && q.includes(c.name.toLowerCase())) { f.clientId = c.id; break }

  if (/\bavailable\b|\bactive\b|\bvacant\b/i.test(q)) f.status = 'active'
  if (/\brented\b|\bleased\b/i.test(q)) f.status = 'leased'

  f.features = FEATURE_WORDS.filter((w) => q.includes(w))

  f.recognisedNothing =
    f.bedrooms === undefined && !f.priceMax && !f.priceMin &&
    !f.neighborhood && !f.clientId && !f.status && f.features.length === 0

  return f
}

export function describeParsed(f: ParsedQuery): string[] {
  const p: string[] = []
  if (f.bedrooms !== undefined) p.push(bedsLabel(f.bedrooms))
  if (f.priceMax) p.push(`under $${f.priceMax.toLocaleString()}`)
  if (f.priceMin) p.push(`over $${f.priceMin.toLocaleString()}`)
  if (f.neighborhood) p.push(`in ${f.neighborhood}`)
  if (f.status) p.push(`status: ${f.status}`)
  if (f.features.length) p.push(`with ${f.features.join(', ')}`)
  return p
}

export interface SearchFilters {
  beds: string
  priceMax: string
  status: string
  clientId: string
  nhoods: Record<string, 'include' | 'exclude'>
}

export function runSearch(
  listings: ListingRow[],
  query: string,
  filters: SearchFilters,
  clients: { id: string; name: string }[],
): { results: ListingRow[]; parsed: ParsedQuery | null } {
  const parsed = query.trim() ? parseNL(query, clients) : null
  let out = listings

  if (parsed) {
    if (parsed.recognisedNothing) {
      // Free-text fallback across everything a person might type.
      const term = query.trim().toLowerCase()
      out = out.filter((l) => [
        l.address, l.unit, l.neighborhood, l.city, l.clientName,
        fmtPrice(l.rentCents), bedsLabel(l.bedrooms), ...l.features,
      ].join(' ').toLowerCase().includes(term))
    } else {
      if (parsed.bedrooms !== undefined) out = out.filter((l) => l.bedrooms === parsed.bedrooms)
      if (parsed.priceMax) out = out.filter((l) => l.rentCents !== null && l.rentCents / 100 <= parsed.priceMax!)
      if (parsed.priceMin) out = out.filter((l) => l.rentCents !== null && l.rentCents / 100 >= parsed.priceMin!)
      if (parsed.neighborhood) out = out.filter((l) => (l.neighborhood ?? '').toLowerCase() === parsed.neighborhood!.toLowerCase())
      if (parsed.clientId) out = out.filter((l) => l.clientId === parsed.clientId)
      if (parsed.status) out = out.filter((l) => l.status === parsed.status)
      if (parsed.features.length) {
        out = out.filter((l) => {
          const blob = l.features.join(' ').toLowerCase()
          return parsed.features.some((w) => blob.includes(w))
        })
      }
    }
  }

  // Dropdown filters apply after, and override, anything the parser inferred —
  // same precedence the original had.
  if (filters.beds !== '') out = out.filter((l) => l.bedrooms === Number(filters.beds))
  if (filters.priceMax !== '') out = out.filter((l) => l.rentCents !== null && l.rentCents / 100 <= Number(filters.priceMax))
  if (filters.status !== '') out = out.filter((l) => l.status === filters.status)
  if (filters.clientId !== '') out = out.filter((l) => l.clientId === filters.clientId)

  const includes = Object.entries(filters.nhoods).filter(([, v]) => v === 'include').map(([k]) => k.toLowerCase())
  const excludes = Object.entries(filters.nhoods).filter(([, v]) => v === 'exclude').map(([k]) => k.toLowerCase())
  if (includes.length) out = out.filter((l) => includes.includes((l.neighborhood ?? '').toLowerCase()))
  if (excludes.length) out = out.filter((l) => !excludes.includes((l.neighborhood ?? '').toLowerCase()))

  return { results: out, parsed }
}
