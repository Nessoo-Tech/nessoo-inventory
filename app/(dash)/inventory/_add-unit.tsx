'use client'

import { useMemo, useState } from 'react'
import type { ClientRow, ListingRow } from '@/lib/queries/inventory-data'
import { NHOODS } from './_search'

/**
 * Add a unit.
 *
 * This is why the button was missing from the rebuild rather than an oversight:
 * the legacy dashboard's form was flat — type an address, done — because its
 * Supabase table stored the address as a string on the listing row. This
 * database is normalised: a unit belongs to a building (`properties`), which
 * belongs to an organization. Those are real foreign keys, not text.
 *
 * So the form asks for the building first. Pick an existing one and the
 * organization is implied; pick "new building" and it is created in the same
 * flow. That keeps a stray unit from being orphaned or grafted onto the wrong
 * company, which is what a flat form would have allowed.
 */
export function AddUnitModal({ clients, listings, onClose, onDone }: {
  clients: ClientRow[]
  listings: ListingRow[]
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [clientId, setClientId] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [newBuilding, setNewBuilding] = useState(false)
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('New York')
  const [zip, setZip] = useState('')
  const [unit, setUnit] = useState('')
  const [beds, setBeds] = useState('1')
  const [baths, setBaths] = useState('1')
  const [rent, setRent] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [available, setAvailable] = useState('')
  const [status, setStatus] = useState('active')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Buildings already belonging to the selected client.
  const buildings = useMemo(() => {
    if (!clientId) return []
    const seen = new Map<string, string>()
    for (const l of listings) {
      if (l.clientId === clientId && !seen.has(l.propertyId)) seen.set(l.propertyId, l.address)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [listings, clientId])

  const neighborhoodOptions = useMemo(
    () => [...new Set([...NHOODS, ...listings.map((l) => l.neighborhood).filter(Boolean) as string[]])].sort(),
    [listings])

  function pickClient(id: string) {
    setClientId(id)
    setPropertyId('')
    // A client with no buildings can only create one, so skip the dead dropdown.
    setNewBuilding(id !== '' && !listings.some((l) => l.clientId === id))
  }

  async function save() {
    setError(null)
    if (!clientId) return setError('Pick a client')
    if (!newBuilding && !propertyId) return setError('Pick a building, or add a new one')
    if (newBuilding && !address.trim()) return setError('Building address is required')
    if (!unit.trim()) return setError('Unit name is required')

    setBusy(true)
    try {
      let targetProperty = propertyId

      if (newBuilding) {
        const res = await fetch('/api/properties', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: clientId, name: address.trim(), address: address.trim(),
            city: city.trim() || 'New York', state: 'NY', zip: zip.trim() || '10001',
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) { setError(j.error ?? `Could not create the building (${res.status})`); return }
        targetProperty = j.id
      }

      const res = await fetch('/api/units', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: clientId, propertyId: targetProperty, name: unit.trim(),
          bedrooms: beds === '' ? null : Number(beds),
          bathrooms: baths === '' ? null : Number(baths),
          rentDollars: rent === '' ? null : Number(rent),
          neighborhood: neighborhood || null,
          availableFrom: available || null,
          status,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? `Could not create the unit (${res.status})`); return }

      onDone(status === 'active' ? 'Unit added — live on Nessoo' : 'Unit added')
      onClose()
    } catch {
      setError('Network error — nothing was created')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }} role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>Add Unit</h2>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Client *</label>
              <select value={clientId} onChange={(e) => pickClient(e.target.value)}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.unitCount})</option>
                ))}
              </select>
            </div>

            {clientId && (
              <div className="form-group full-width">
                <label>Building *</label>
                {newBuilding ? (
                  <>
                    <input placeholder="123 Main Street" value={address} onChange={(e) => setAddress(e.target.value)} />
                    {buildings.length > 0 && (
                      <button className="btn-secondary sm" style={{ marginTop: 6, alignSelf: 'flex-start' }}
                        onClick={() => setNewBuilding(false)} disabled={busy}>
                        Use an existing building instead
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                      <option value="">Select building…</option>
                      {buildings.map(([id, addr]) => <option key={id} value={id}>{addr}</option>)}
                    </select>
                    <button className="btn-secondary sm" style={{ marginTop: 6, alignSelf: 'flex-start' }}
                      onClick={() => setNewBuilding(true)} disabled={busy}>
                      + Add a new building
                    </button>
                  </>
                )}
              </div>
            )}

            {newBuilding && clientId && (
              <>
                <div className="form-group"><label>City</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="New York" /></div>
                <div className="form-group"><label>Zip</label>
                  <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10001" /></div>
              </>
            )}

            <div className="form-group"><label>Unit *</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4A" /></div>
            <div className="form-group"><label>Price ($/mo)</label>
              <input type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} placeholder="2000" /></div>
            <div className="form-group">
              <label>Bedrooms</label>
              <select value={beds} onChange={(e) => setBeds(e.target.value)}>
                <option value="">Not set</option><option value="0">Studio</option>
                {[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Bathrooms</label>
              <input type="number" min={0} step={0.5} value={baths} onChange={(e) => setBaths(e.target.value)} /></div>
            <div className="form-group">
              <label>Neighborhood</label>
              <select value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)}>
                <option value="">Not set</option>
                {neighborhoodOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Available from</label>
              <input type="date" value={available} onChange={(e) => setAvailable(e.target.value)} /></div>
            <div className="form-group full-width">
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Vacant — publish on Nessoo</option>
                <option value="inactive">Inactive — keep off the marketplace</option>
                <option value="leased">Rented</option>
              </select>
            </div>
          </div>

          {!neighborhood && (
            <p className="caveat">
              Without a neighborhood this unit is invisible to neighborhood search and to every
              /nyc page. 99 of your live units already have this problem — see the Health tab.
            </p>
          )}
          {error && (
            <p className="caveat" style={{ color: 'var(--red)', background: 'var(--red-soft)', borderColor: 'rgba(239,68,68,.25)' }}>
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save Unit'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Archive a unit.
 *
 * Deliberately a soft delete: the row is kept with `deleted_at` set, matching
 * how every removal in this platform works. The database role has no DELETE
 * grant at all, so a hard delete is not reachable from this console even by
 * mistake — and a unit with live connection requests attached to it would take
 * that history down with it.
 *
 * A reason is required because this is cross-org: an internal admin removing
 * another company's listing should leave a record saying why.
 */
export function ArchiveUnitModal({ listing, onClose, onDone }: {
  listing: ListingRow
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function archive() {
    if (!reason.trim()) return setError('A reason is required — it goes in the audit log')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${encodeURIComponent(listing.id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? `Could not archive (${res.status})`); return }
      onDone('Unit archived — removed from Nessoo')
      onClose()
    } catch {
      setError('Network error — nothing was changed')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }} role="dialog" aria-modal="true">
      <div className="modal" style={{ width: 460 }}>
        <div className="modal-header">
          <h2>Archive Unit</h2>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 6 }}>
            {listing.address} {listing.unit}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            {listing.clientName} · {listing.neighborhood ?? 'no neighborhood'}
          </p>
          <div className="form-group">
            <label>Reason *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. leased off-platform, listing withdrawn by owner, duplicate" />
          </div>
          <p className="caveat">
            Removes it from the marketplace immediately. This is a soft delete — the record and its
            history are kept, and it can be restored by clearing <code>deleted_at</code>. Your name
            and this reason are written to the audit log in the same transaction.
          </p>
          {error && (
            <p className="caveat" style={{ color: 'var(--red)', background: 'var(--red-soft)', borderColor: 'rgba(239,68,68,.25)' }}>
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-danger" style={{ marginRight: 0 }} onClick={archive} disabled={busy}>
            {busy ? 'Archiving…' : 'Archive Unit'}
          </button>
        </div>
      </div>
    </div>
  )
}
