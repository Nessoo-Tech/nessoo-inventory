'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UnitPhoto } from '@/lib/queries/photos'

/**
 * Photo manager for one unit.
 *
 * Uploads go to our own API rather than straight to storage, which is slower by
 * one hop and deliberate: the server re-encodes every image to strip EXIF —
 * property photos routinely carry GPS coordinates and a camera serial number —
 * and that is impossible if the bytes never reach us.
 *
 * The bucket is private, so every `src` here is a signed URL that expires. They
 * are minted server-side on page load, so a stale tab may eventually show
 * broken thumbnails; onError swaps in a placeholder rather than a broken-image
 * icon, and a refresh re-signs them.
 */
export function UnitPhotos({ unitId, initial, storageReady, onCountChange }: {
  unitId: string
  initial: UnitPhoto[]
  storageReady: boolean
  onCountChange?: (n: number) => void
}) {
  const [photos, setPhotos] = useState<UnitPhoto[]>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { onCountChange?.(photos.length) }, [photos.length, onCountChange])

  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      for (const f of list) form.append('file', f)
      const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/photos`, {
        method: 'POST', body: form,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? `Upload failed (${res.status})`); return }
      setPhotos((p) => [...p, ...(j.photos ?? [])])
      // Per-file outcomes: one bad image should not hide that the rest landed.
      if (j.failed?.length) {
        setError(`${j.failed.length} file(s) skipped: ${j.failed.map((f: { name: string; reason: string }) => `${f.name} (${f.reason})`).join(', ')}`)
      }
    } catch {
      setError('Network error — nothing was uploaded')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }, [unitId])

  async function remove(id: string) {
    if (!window.confirm('Remove this photo? It is deleted from storage as well.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Could not remove the photo')
        return
      }
      setPhotos((p) => p.filter((x) => x.id !== id))
    } finally { setBusy(false) }
  }

  async function persistOrder(next: UnitPhoto[]) {
    setPhotos(next)   // optimistic: the drag already moved it visually
    try {
      await fetch(`/api/units/${encodeURIComponent(unitId)}/photos`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds: next.map((p) => p.id) }),
      })
    } catch {
      setError('Order could not be saved — reload to see the stored order')
    }
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    const from = photos.findIndex((p) => p.id === dragId)
    const to = photos.findIndex((p) => p.id === targetId)
    if (from < 0 || to < 0) return
    const next = [...photos]
    next.splice(to, 0, ...next.splice(from, 1))
    setDragId(null)
    void persistOrder(next)
  }

  function makeCover(id: string) {
    const i = photos.findIndex((p) => p.id === id)
    if (i <= 0) return
    const next = [...photos]
    next.unshift(...next.splice(i, 1))
    void persistOrder(next)
  }

  if (!storageReady) {
    return (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div className="user-pref-label" style={{ marginBottom: 8 }}>Photos</div>
        <p className="caveat" style={{ margin: 0 }}>
          Photo storage is not connected yet. Once the Cloudflare R2 credentials are set, uploads
          appear here and on the renter side — see <code>docs/R2_SETUP.md</code>.
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="user-pref-label" style={{ marginBottom: 0 }}>
          Photos {photos.length > 0 && `· ${photos.length}`}
        </div>
        {photos.length > 1 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>drag to reorder · first is the cover</span>
        )}
      </div>

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginBottom: 10 }}>
          {photos.map((p, i) => (
            <div
              key={p.id}
              draggable={!busy}
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p.id)}
              style={{
                position: 'relative', aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden',
                border: i === 0 ? '2px solid var(--green)' : '1px solid var(--border-strong)',
                background: 'var(--bg-surface)', cursor: busy ? 'default' : 'grab',
                opacity: dragId === p.id ? 0.4 : 1,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed,
                  expiring URL on a private bucket; next/image would proxy and
                  cache it, which defeats the expiry. */}
              <img
                src={p.thumbUrl ?? p.url ?? ''}
                alt={p.alt ?? ''}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
              />
              {i === 0 && (
                <span style={{
                  position: 'absolute', top: 4, left: 4, fontSize: 9, fontWeight: 700,
                  letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 5px',
                  borderRadius: 3, background: 'var(--green)', color: 'var(--bg)',
                }}>Cover</span>
              )}
              <div style={{ position: 'absolute', bottom: 4, right: 4, display: 'flex', gap: 3 }}>
                {i !== 0 && (
                  <button
                    type="button" title="Make cover" disabled={busy}
                    onClick={() => makeCover(p.id)}
                    style={miniBtn}
                  >&#9733;</button>
                )}
                <button
                  type="button" title="Remove" disabled={busy}
                  onClick={() => remove(p.id)}
                  style={{ ...miniBtn, color: 'var(--red)' }}
                >&#10005;</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files) }}
        onClick={() => fileInput.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') fileInput.current?.click() }}
        style={{
          border: `1px dashed ${dragOver ? 'var(--green)' : 'rgba(74,222,128,.3)'}`,
          background: dragOver ? 'var(--green-soft)' : 'transparent',
          borderRadius: 8, padding: '14px 12px', textAlign: 'center', cursor: 'pointer',
          transition: 'all .12s',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
          {busy ? 'Uploading…' : photos.length ? '+ Add more photos' : '+ Add photos'}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
          drag and drop, or click · JPEG/PNG/WebP · up to 4 MB each
        </div>
      </div>

      <input
        ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif"
        multiple hidden onChange={(e) => e.target.files && upload(e.target.files)}
      />

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.55 }}>
        Every upload is re-encoded server-side, which removes EXIF, GPS coordinates and camera
        details — a saved copy carries only the pixels. Images are stored privately and served
        through links that expire.
      </p>

      {error && (
        <p className="caveat" style={{ color: 'var(--red)', background: 'var(--red-soft)', borderColor: 'rgba(239,68,68,.25)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  width: 20, height: 20, border: 'none', borderRadius: 4,
  background: 'rgba(20,26,18,.82)', color: 'var(--text)',
  fontSize: 10, cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 0,
}
