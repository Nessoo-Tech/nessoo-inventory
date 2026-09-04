'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { UnitRow, UnitStatus } from '@/lib/queries/inventory'

const STATUSES: UnitStatus[] = ['active', 'inactive', 'leased', 'archived']

const STATUS_COLOR: Record<UnitStatus, string> = {
  active: 'var(--good)',
  inactive: 'var(--text-faint)',
  leased: 'var(--brand)',
  archived: 'var(--bad)',
}

export function UnitTable({ units }: { units: UnitRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function send(unitId: string, method: 'PATCH' | 'DELETE', body: unknown) {
    setBusyId(unitId)
    setError(null)
    try {
      const res = await fetch(`/api/units/${encodeURIComponent(unitId)}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Request failed (${res.status})`)
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error — nothing was changed.')
    } finally {
      setBusyId(null)
    }
  }

  function onStatusChange(unit: UnitRow, status: UnitStatus) {
    if (status === unit.status) return
    void send(unit.id, 'PATCH', { status })
  }

  function onArchive(unit: UnitRow) {
    const reason = window.prompt(
      `Archive "${unit.name}" at ${unit.address}?\n\nThis hides it from the marketplace. Give a reason — it goes in the audit log.`,
    )
    if (!reason?.trim()) return
    void send(unit.id, 'DELETE', { reason })
  }

  if (units.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>No units.</p>
  }

  return (
    <div>
      {error && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--bad)',
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: 6,
            padding: '8px 10px',
            margin: '0 0 12px',
          }}
        >
          {error}
        </p>
      )}
      <div className="scroll-x" style={{ opacity: pending ? 0.6 : 1 }}>
        <table>
          <thead>
            <tr>
              <th>Building</th>
              <th>Unit</th>
              <th>Neighborhood</th>
              <th>Beds</th>
              <th>Rent</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} style={{ opacity: busyId === u.id ? 0.5 : 1 }}>
                <td style={{ color: 'var(--text)' }}>
                  {u.address}
                  <span style={{ color: 'var(--text-faint)', fontSize: 11, display: 'block' }}>
                    {u.orgName}
                  </span>
                </td>
                <td>{u.name}</td>
                <td>{u.neighborhood ?? '—'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{u.bedrooms ?? '—'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {u.rentCents == null ? '—' : `$${(u.rentCents / 100).toLocaleString()}`}
                </td>
                <td>
                  <select
                    value={u.status}
                    disabled={busyId === u.id}
                    onChange={(e) => onStatusChange(u, e.target.value as UnitStatus)}
                    style={{
                      background: 'var(--surface-2)',
                      color: STATUS_COLOR[u.status],
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '3px 6px',
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s} style={{ color: 'var(--text)' }}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    onClick={() => onArchive(u)}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-faint)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
