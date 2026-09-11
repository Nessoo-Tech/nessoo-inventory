// Canonical NYC neighborhoods — a MIRROR of homey-ux lib/geo/nyc-neighborhoods.ts.
//
// Why a copy: these are separate repos and separate deploys, so this console
// cannot import that module. The names must still agree exactly, because
// homey-ux looks a stored neighborhood up with `n.name === name` — an exact
// string compare. A name that differs by one character has no public /nyc page
// and no sitemap URL, and nothing anywhere reports the mismatch.
//
// Generated from that file, not typed by hand. To re-sync after neighborhoods
// are added there, re-read its RAW table; `npm run verify:neighborhoods`
// reports names that are in use in the database but not in this list.
//
// Measured when this was written: the console's own hardcoded 30-name list had
// ELEVEN names that were not canonical, and one unit was already saved as
// "Bed-Stuy" where canonical is "Bedford-Stuyvesant".

export type BoroughSlug = 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten-island'

/** [name, borough] for every neighborhood with a public page. */
export const CANONICAL: readonly (readonly [string, BoroughSlug])[] = [
  // manhattan
  ['Lower East Side', 'manhattan'],
  ['East Village', 'manhattan'],
  ['Harlem', 'manhattan'],
  ['Washington Heights', 'manhattan'],
  ['Hells Kitchen', 'manhattan'],
  ['Upper East Side', 'manhattan'],
  ['Upper West Side', 'manhattan'],
  ['Chelsea', 'manhattan'],
  ['Inwood', 'manhattan'],
  ['Financial District', 'manhattan'],
  ['Murray Hill', 'manhattan'],
  ['Kips Bay', 'manhattan'],
  ['Midtown', 'manhattan'],
  ['Hudson Yards', 'manhattan'],
  ['Midtown South', 'manhattan'],
  ['West Village', 'manhattan'],
  ['East Harlem', 'manhattan'],
  ['Soho', 'manhattan'],
  ['Gramercy Park', 'manhattan'],
  ['Tribeca', 'manhattan'],
  ['Morningside Heights', 'manhattan'],
  ['West Harlem', 'manhattan'],
  ['Central Harlem', 'manhattan'],
  ['South Harlem', 'manhattan'],
  ['Nolita', 'manhattan'],
  ['Noho', 'manhattan'],
  ['Little Italy', 'manhattan'],
  ['Greenwich Village', 'manhattan'],
  ['Two Bridges', 'manhattan'],
  ['Beekman', 'manhattan'],
  ['Midtown West', 'manhattan'],
  ['Fort George', 'manhattan'],
  // brooklyn
  ['Williamsburg', 'brooklyn'],
  ['Bushwick', 'brooklyn'],
  ['Bedford-Stuyvesant', 'brooklyn'],
  ['Park Slope', 'brooklyn'],
  ['Crown Heights', 'brooklyn'],
  ['Greenpoint', 'brooklyn'],
  ['Sunset Park', 'brooklyn'],
  ['Fort Greene', 'brooklyn'],
  ['Flatbush', 'brooklyn'],
  ['Gowanus', 'brooklyn'],
  ['Clinton Hill', 'brooklyn'],
  ['Cobble Hill', 'brooklyn'],
  ['Boerum Hill', 'brooklyn'],
  ['Downtown Brooklyn', 'brooklyn'],
  ['Stuyvesant Heights', 'brooklyn'],
  // queens
  ['Long Island City', 'queens'],
  ['Astoria', 'queens'],
  ['Sunnyside', 'queens'],
  ['Jackson Heights', 'queens'],
  ['Ridgewood', 'queens'],
  ['Forest Hills', 'queens'],
  ['Hunters Point', 'queens'],
  ['Briarwood', 'queens'],
  ['Woodside', 'queens'],
  // bronx
  ['Mott Haven', 'bronx'],
  ['Concourse', 'bronx'],
  ['Riverdale', 'bronx'],
  ['Schuylerville', 'bronx'],
  // staten-island
  ['St. George', 'staten-island'],
  ['Stapleton', 'staten-island'],
] as const

export const CANONICAL_NAMES: readonly string[] = CANONICAL.map(([n]) => n)

/**
 * Names people actually type that must land on a canonical spelling.
 *
 * Three kinds, all of them real hazards now that the field accepts free text:
 *   · canonical drops apostrophes and dots  ("Hell's Kitchen" -> "Hells Kitchen")
 *   · canonical uses plain casing           ("SoHo" -> "Soho", "NoHo" -> "Noho")
 *   · local shorthand                       ("Bed-Stuy", "LIC", "FiDi")
 *
 * Keys are compared loosely (see `fold`), so only genuinely different WORDS
 * need an entry — case and punctuation variants are handled without one.
 */
export const ALIASES: Readonly<Record<string, string>> = {
  'bedstuy': 'Bedford-Stuyvesant',
  'lic': 'Long Island City',
  'fidi': 'Financial District',
  'uws': 'Upper West Side',
  'ues': 'Upper East Side',
  'les': 'Lower East Side',
  // Clinton is the older name for the same area; "Clinton Hill" is a DIFFERENT
  // Brooklyn neighborhood and folds to 'clintonhill', so it is unaffected.
  'clintonhellskitchen': 'Hells Kitchen',
  // No entry for DUMBO on purpose: it is its own neighborhood, absent from the
  // canonical list. Pointing it at Downtown Brooklyn would file those units
  // under the wrong area to buy them a public page — a worse outcome than not
  // having one. It stays free text until the gazetteer gains it.
  // Nothing here for "Hell's Kitchen", "SoHo", "St George" or
  // "Bedford Stuyvesant" either: those fold onto a canonical name already.
}

/** Case-, space- and punctuation-insensitive key. "Hell's Kitchen" and
 *  "hells kitchen" fold to the same thing, which is the whole point. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const BY_FOLDED = new Map(CANONICAL.map(([n, b]) => [fold(n), { name: n, borough: b }]))

/** Slug rules copied from homey-ux slugify() — apostrophes and dots are
 *  DROPPED, not turned into hyphens, so "St. George" is "st-george". */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export interface Resolved {
  /** What to save. The canonical spelling when one matched, else the trimmed input. */
  name: string
  /** True when this name has a public /nyc page. */
  canonical: boolean
  /** Set when the typed text was corrected, so the form can say so. */
  snappedFrom?: string
  /** The public page path, when canonical. */
  path?: string
}

/**
 * Decide what to store for a typed neighborhood.
 *
 * A loose match snaps to the canonical spelling rather than saving the variant:
 * "SoHo" and "Soho" must not become two neighborhoods splitting one area's
 * inventory, with only one of them reachable from a public page.
 *
 * Anything unrecognised is returned as typed. That is the point of the field —
 * new neighborhoods appear all the time, renter search reads them straight from
 * the database, and refusing them would be worse than a missing SEO page.
 */
export function resolveNeighborhood(input: string): Resolved | null {
  const trimmed = input.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null

  const k = fold(trimmed)
  const direct = BY_FOLDED.get(k)
  const aliased = !direct && ALIASES[k] ? BY_FOLDED.get(fold(ALIASES[k])) : undefined
  const hit = direct ?? aliased

  if (hit) {
    return {
      name: hit.name,
      canonical: true,
      snappedFrom: hit.name === trimmed ? undefined : trimmed,
      path: `/nyc/${hit.borough}/${slugify(hit.name)}`,
    }
  }
  return { name: trimmed, canonical: false }
}
