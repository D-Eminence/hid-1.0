import React, { useEffect, useState } from 'react'
import { Button, Input, Modal, Select, Textarea, showToast } from './ui'
import { SHARE_DURATION_PRESETS, SHARE_PERMISSION_TIERS } from '../lib/shareUtils'
import { createShare, searchStaffForShare } from '../lib/hidApi'
import type { HidShareDurationPreset, HidSharePermissionTier, HidStaffSearchResult } from '../types/hid'

interface ShareProfileModalProps {
  open: boolean
  onClose: () => void
  onShared: () => void
}

export function ShareProfileModal({ open, onClose, onShared }: ShareProfileModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HidStaffSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<HidStaffSearchResult | null>(null)
  const [permissionTier, setPermissionTier] = useState<HidSharePermissionTier>('view_only')
  const [durationPreset, setDurationPreset] = useState<HidShareDurationPreset>('7d')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }

    setSearching(true)
    const timeout = setTimeout(() => {
      searchStaffForShare(trimmed)
        .then(setResults)
        .catch(error => {
          const message = error instanceof Error ? error.message : 'Unable to search for providers.'
          showToast(message, 'error')
        })
        .finally(() => setSearching(false))
    }, 300)

    return () => clearTimeout(timeout)
  }, [query, open])

  function reset() {
    setQuery('')
    setResults([])
    setSelected(null)
    setPermissionTier('view_only')
    setDurationPreset('7d')
    setReason('')
  }

  function handleClose() {
    if (saving) return
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!selected || saving) return
    setSaving(true)
    try {
      await createShare({
        staffAccountId: selected.staff_account_id,
        permissionTier,
        durationPreset,
        reason: reason.trim() || undefined,
      })
      showToast('Profile shared.', 'success')
      reset()
      onClose()
      onShared()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to share your profile.'
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Share my profile" width={520}>
      <div style={{ display: 'grid', gap: 14 }}>
        {!selected ? (
          <>
            <Input
              label="Find a provider"
              placeholder="Search by name, hospital, or email"
              value={query}
              onChange={e => setQuery(e.target.value)}
              hint="Only active, verified providers can be found here."
            />

            {searching && <p style={{ fontSize: 13, color: '#6b7280' }}>Searching...</p>}

            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p style={{ fontSize: 13, color: '#9ca3af' }}>No matching providers found.</p>
            )}

            {results.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                {results.map(result => (
                  <button
                    key={result.staff_account_id}
                    type="button"
                    onClick={() => setSelected(result)}
                    style={{
                      textAlign: 'left',
                      borderRadius: 12,
                      border: '1px solid #edf1f5',
                      background: '#fff',
                      padding: '10px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{result.full_name}</span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {result.hospital_name ?? 'Independent practitioner'} · {result.role}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ border: '1px solid #edf1f5', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{selected.full_name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{selected.hospital_name ?? 'Independent practitioner'} · {selected.role}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                disabled={saving}
                style={{ border: 'none', background: 'none', color: '#1a6fd4', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 12, padding: 0 }}
              >
                Change
              </button>
            </div>

            <Select
              label="Access level"
              value={permissionTier}
              onChange={e => setPermissionTier(e.target.value as HidSharePermissionTier)}
              options={SHARE_PERMISSION_TIERS.map(tier => ({ value: tier.value, label: tier.label }))}
            />
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: -8 }}>
              {SHARE_PERMISSION_TIERS.find(tier => tier.value === permissionTier)?.description}
            </p>

            <Select
              label="Duration"
              value={durationPreset}
              onChange={e => setDurationPreset(e.target.value as HidShareDurationPreset)}
              options={SHARE_DURATION_PRESETS}
            />

            <Textarea
              label="Reason (optional)"
              placeholder="e.g. Ongoing care with this provider"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>Cancel</Button>
          {selected && (
            <Button loading={saving} onClick={() => void handleSubmit()}>Share profile</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
