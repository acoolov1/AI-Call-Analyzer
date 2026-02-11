'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { useUser } from '@/hooks/use-user'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { useSelectedUser } from '@/hooks/use-selected-user'
import { buildApiUrl } from '@/lib/api-helpers'
import { useQueryClient } from '@tanstack/react-query'

type ExtensionRow = {
  number: string
  name: string | null
  status: 'online' | 'offline' | string
}

type RecordingOverrideFlags = {
  inExternal?: boolean
  outExternal?: boolean
  inInternal?: boolean
  outInternal?: boolean
}

type RecordingOverrides = Record<string, RecordingOverrideFlags>

const sanitizeRecordingOverrides = (value: any): RecordingOverrides => {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const out: RecordingOverrides = {}
  for (const [extKey, rawFlags] of Object.entries(obj)) {
    const ext = String(extKey || '').trim()
    if (!/^\d+$/.test(ext)) continue
    if (!rawFlags || typeof rawFlags !== 'object' || Array.isArray(rawFlags)) continue
    const flags = rawFlags as any
    const entry: RecordingOverrideFlags = {}
    if (flags.inExternal === true) entry.inExternal = true
    if (flags.outExternal === true) entry.outExternal = true
    if (flags.inInternal === true) entry.inInternal = true
    if (flags.outInternal === true) entry.outInternal = true
    if (Object.keys(entry).length > 0) out[ext] = entry
  }
  return out
}

export default function FreepbxExtensionsPage() {
  const { status } = useSession()
  const { data: currentUser } = useUser()
  const { selectedUserId } = useAdminUser()
  const { data: selectedUser, isLoading: isUserLoading } = useSelectedUser()
  const queryClient = useQueryClient()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [extensions, setExtensions] = useState<ExtensionRow[]>([])
  const [excludedInbound, setExcludedInbound] = useState<Set<string>>(new Set())
  const [excludedOutbound, setExcludedOutbound] = useState<Set<string>>(new Set())
  const [excludedInternal, setExcludedInternal] = useState<Set<string>>(new Set())
  const [recordingOverrides, setRecordingOverrides] = useState<RecordingOverrides>({})
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string>('')

  useEffect(() => {
    if (status === 'unauthenticated') redirect('/login')
  }, [status])

  useEffect(() => {
    const run = async () => {
      if (!currentUser) return
      if (currentUser.role !== 'super_admin') {
        redirect('/dashboard')
      }

      setIsLoading(true)
      setError('')
      try {
        const params: any = {}
        if (selectedUserId) params.userId = selectedUserId
        const { data } = await apiClient.post('/api/v1/integrations/freepbx/extensions/refresh', undefined, { params })
        const list = Array.isArray(data?.data?.extensions) ? data.data.extensions : []
        setExtensions(list)
      } catch (e: any) {
        const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to load extensions'
        setError(msg)
      } finally {
        setIsLoading(false)
      }
    }

    run()
  }, [currentUser, selectedUserId])

  useEffect(() => {
    const inbound = selectedUser?.freepbxSettings?.call_history_excluded_inbound_extensions
    const outbound = selectedUser?.freepbxSettings?.call_history_excluded_outbound_extensions
    const internal = selectedUser?.freepbxSettings?.call_history_excluded_internal_extensions
    const rec = (selectedUser as any)?.freepbxSettings?.call_recording_overrides
    setExcludedInbound(new Set(Array.isArray(inbound) ? inbound.map((v) => String(v || '').trim()).filter(Boolean) : []))
    setExcludedOutbound(new Set(Array.isArray(outbound) ? outbound.map((v) => String(v || '').trim()).filter(Boolean) : []))
    setExcludedInternal(new Set(Array.isArray(internal) ? internal.map((v) => String(v || '').trim()).filter(Boolean) : []))
    setRecordingOverrides(sanitizeRecordingOverrides(rec))
  }, [
    selectedUser?.id,
    selectedUser?.freepbxSettings?.call_history_excluded_inbound_extensions,
    selectedUser?.freepbxSettings?.call_history_excluded_outbound_extensions,
    selectedUser?.freepbxSettings?.call_history_excluded_internal_extensions,
    (selectedUser as any)?.freepbxSettings?.call_recording_overrides,
  ])

  const counts = useMemo(() => {
    const online = extensions.filter((e) => String(e.status).toLowerCase() === 'online').length
    const offline = extensions.length - online
    return { total: extensions.length, online, offline }
  }, [extensions])

  const allExtensionNumbers = useMemo(() => {
    return extensions.map((e) => String(e.number || '').trim()).filter(Boolean)
  }, [extensions])

  const excludedInboundInListCount = useMemo(() => {
    if (allExtensionNumbers.length === 0) return 0
    let count = 0
    for (const n of allExtensionNumbers) if (excludedInbound.has(n)) count++
    return count
  }, [allExtensionNumbers, excludedInbound])

  const excludedOutboundInListCount = useMemo(() => {
    if (allExtensionNumbers.length === 0) return 0
    let count = 0
    for (const n of allExtensionNumbers) if (excludedOutbound.has(n)) count++
    return count
  }, [allExtensionNumbers, excludedOutbound])

  const excludedInternalInListCount = useMemo(() => {
    if (allExtensionNumbers.length === 0) return 0
    let count = 0
    for (const n of allExtensionNumbers) if (excludedInternal.has(n)) count++
    return count
  }, [allExtensionNumbers, excludedInternal])

  const inboundAllIncluded = allExtensionNumbers.length > 0 && excludedInboundInListCount === 0
  const inboundNoneIncluded = allExtensionNumbers.length > 0 && excludedInboundInListCount === allExtensionNumbers.length
  const inboundIndeterminate = allExtensionNumbers.length > 0 && !inboundAllIncluded && !inboundNoneIncluded

  const outboundAllIncluded = allExtensionNumbers.length > 0 && excludedOutboundInListCount === 0
  const outboundNoneIncluded = allExtensionNumbers.length > 0 && excludedOutboundInListCount === allExtensionNumbers.length
  const outboundIndeterminate = allExtensionNumbers.length > 0 && !outboundAllIncluded && !outboundNoneIncluded

  const internalAllIncluded = allExtensionNumbers.length > 0 && excludedInternalInListCount === 0
  const internalNoneIncluded = allExtensionNumbers.length > 0 && excludedInternalInListCount === allExtensionNumbers.length
  const internalIndeterminate = allExtensionNumbers.length > 0 && !internalAllIncluded && !internalNoneIncluded

  const inboundHeaderRef = useRef<HTMLInputElement | null>(null)
  const outboundHeaderRef = useRef<HTMLInputElement | null>(null)
  const internalHeaderRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inboundHeaderRef.current) inboundHeaderRef.current.indeterminate = inboundIndeterminate
    if (outboundHeaderRef.current) outboundHeaderRef.current.indeterminate = outboundIndeterminate
    if (internalHeaderRef.current) internalHeaderRef.current.indeterminate = internalIndeterminate
  }, [inboundIndeterminate, outboundIndeterminate, internalIndeterminate])

  const toggleInclude = (extNumber: string, dir: 'inbound' | 'outbound' | 'internal', include: boolean) => {
    const n = String(extNumber || '').trim()
    if (!n) return
    if (dir === 'inbound') {
      setExcludedInbound((prev) => {
        const next = new Set(prev)
        if (include) next.delete(n)
        else next.add(n)
        return next
      })
    } else if (dir === 'outbound') {
      setExcludedOutbound((prev) => {
        const next = new Set(prev)
        if (include) next.delete(n)
        else next.add(n)
        return next
      })
    } else {
      setExcludedInternal((prev) => {
        const next = new Set(prev)
        if (include) next.delete(n)
        else next.add(n)
        return next
      })
    }
  }

  const setAllIncluded = (dir: 'inbound' | 'outbound' | 'internal', includeAll: boolean) => {
    if (dir === 'inbound') {
      setExcludedInbound(includeAll ? new Set() : new Set(allExtensionNumbers))
    } else if (dir === 'outbound') {
      setExcludedOutbound(includeAll ? new Set() : new Set(allExtensionNumbers))
    } else {
      setExcludedInternal(includeAll ? new Set() : new Set(allExtensionNumbers))
    }
  }

  const setRecordingOverride = (extNumber: string, key: keyof RecordingOverrideFlags, enabled: boolean) => {
    const n = String(extNumber || '').trim()
    if (!n) return
    setRecordingOverrides((prev) => {
      const prevEntry = prev[n] || {}
      const nextEntry: RecordingOverrideFlags = { ...prevEntry, [key]: enabled }
      // Keep object minimal: store only true flags.
      for (const k of ['inExternal', 'outExternal', 'inInternal', 'outInternal'] as Array<keyof RecordingOverrideFlags>) {
        if (nextEntry[k] !== true) delete nextEntry[k]
      }
      const next: RecordingOverrides = { ...prev }
      if (Object.keys(nextEntry).length === 0) {
        delete next[n]
      } else {
        next[n] = nextEntry
      }
      return next
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage('')
    try {
      const url = buildApiUrl('/api/v1/user/preferences', selectedUserId)
      const { data } = await apiClient.patch(url, {
        freepbxSettings: {
          call_history_include_inbound: !inboundNoneIncluded,
          call_history_include_outbound: !outboundNoneIncluded,
          call_history_include_internal: !internalNoneIncluded,
          call_history_excluded_inbound_extensions: Array.from(excludedInbound),
          call_history_excluded_outbound_extensions: Array.from(excludedOutbound),
          call_history_excluded_internal_extensions: Array.from(excludedInternal),
          call_recording_overrides: sanitizeRecordingOverrides(recordingOverrides),
        },
      })
      // Immediately sync from server response + refetch user query (covers any normalization).
      const inbound = data?.data?.freepbxSettings?.call_history_excluded_inbound_extensions
      const outbound = data?.data?.freepbxSettings?.call_history_excluded_outbound_extensions
      const internal = data?.data?.freepbxSettings?.call_history_excluded_internal_extensions
      const rec = data?.data?.freepbxSettings?.call_recording_overrides
      setExcludedInbound(new Set(Array.isArray(inbound) ? inbound.map((v: any) => String(v || '').trim()).filter(Boolean) : []))
      setExcludedOutbound(new Set(Array.isArray(outbound) ? outbound.map((v: any) => String(v || '').trim()).filter(Boolean) : []))
      setExcludedInternal(new Set(Array.isArray(internal) ? internal.map((v: any) => String(v || '').trim()).filter(Boolean) : []))
      setRecordingOverrides(sanitizeRecordingOverrides(rec))
      await queryClient.invalidateQueries({ queryKey: ['user'] })
      await queryClient.invalidateQueries({ queryKey: ['user', selectedUserId || 'current'] })
      setSaveMessage('Saved. Applying to FreePBX…')

      // Push overrides to FreePBX (single SSH session, batch updates).
      try {
        const applyUrl = buildApiUrl('/api/v1/integrations/freepbx/extensions/recording-overrides/apply', selectedUserId)
        await apiClient.post(applyUrl)
      } catch (applyErr: any) {
        const msg =
          applyErr?.response?.data?.error ||
          applyErr?.response?.data?.message ||
          applyErr?.message ||
          'Failed to apply recording overrides to FreePBX.'
        setSaveMessage(`Saved, but failed to apply to FreePBX: ${msg}`)
        setTimeout(() => setSaveMessage(''), 4000)
        return
      }

      setSaveMessage('Saved & applied')
      setTimeout(() => setSaveMessage(''), 2500)
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to save'
      setSaveMessage(msg)
    } finally {
      setIsSaving(false)
    }
  }

  const statusBadgeClass = (value: string) => {
    const s = String(value || '').toLowerCase()
    if (s === 'online') return 'status-positive'
    return 'status-neutral'
  }

  return (
    <DashboardLayout>
      <div className="page">
        <div className="header">
          <div>
            <h1 className="title">Extensions</h1>
            <div className="subtitle">
              {isLoading ? 'Loading…' : `${counts.total} total • ${counts.online} online • ${counts.offline} offline`}
            </div>
          </div>
          <div className="actions">
            {saveMessage && <div className="save-msg">{saveMessage}</div>}
            <button className="btn" type="button" onClick={handleSave} disabled={isSaving || isLoading || isUserLoading}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Extension</th>
                <th>Name</th>
                <th>Status</th>
                <th>
                  <label className="th-check">
                    <input
                      ref={inboundHeaderRef}
                      type="checkbox"
                      checked={inboundAllIncluded}
                      onChange={(e) => setAllIncluded('inbound', e.target.checked)}
                      disabled={isLoading || isUserLoading || extensions.length === 0}
                    />
                    <span>Inbound</span>
                  </label>
                </th>
                <th>
                  <label className="th-check">
                    <input
                      ref={outboundHeaderRef}
                      type="checkbox"
                      checked={outboundAllIncluded}
                      onChange={(e) => setAllIncluded('outbound', e.target.checked)}
                      disabled={isLoading || isUserLoading || extensions.length === 0}
                    />
                    <span>Outbound</span>
                  </label>
                </th>
                <th>
                  <label className="th-check">
                    <input
                      ref={internalHeaderRef}
                      type="checkbox"
                      checked={internalAllIncluded}
                      onChange={(e) => setAllIncluded('internal', e.target.checked)}
                      disabled={isLoading || isUserLoading || extensions.length === 0}
                    />
                    <span>Internal</span>
                  </label>
                </th>
                <th>Inbound External</th>
                <th>Outbound External</th>
                <th>Inbound Internal</th>
                <th>Outbound Internal</th>
              </tr>
            </thead>
            <tbody>
              {extensions.map((ext) => (
                <tr key={ext.number}>
                  <td className="mono">{ext.number}</td>
                  <td>{ext.name || ''}</td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(ext.status)}`}>
                      {String(ext.status).toLowerCase() === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!excludedInbound.has(ext.number)}
                        onChange={(e) => toggleInclude(ext.number, 'inbound', e.target.checked)}
                      />
                      <span>Include</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!excludedOutbound.has(ext.number)}
                        onChange={(e) => toggleInclude(ext.number, 'outbound', e.target.checked)}
                      />
                      <span>Include</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!excludedInternal.has(ext.number)}
                        onChange={(e) => toggleInclude(ext.number, 'internal', e.target.checked)}
                      />
                      <span>Include</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={recordingOverrides[ext.number]?.inExternal === true}
                        onChange={(e) => setRecordingOverride(ext.number, 'inExternal', e.target.checked)}
                      />
                      <span>Enable</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={recordingOverrides[ext.number]?.outExternal === true}
                        onChange={(e) => setRecordingOverride(ext.number, 'outExternal', e.target.checked)}
                      />
                      <span>Enable</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={recordingOverrides[ext.number]?.inInternal === true}
                        onChange={(e) => setRecordingOverride(ext.number, 'inInternal', e.target.checked)}
                      />
                      <span>Enable</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={recordingOverrides[ext.number]?.outInternal === true}
                        onChange={(e) => setRecordingOverride(ext.number, 'outInternal', e.target.checked)}
                      />
                      <span>Enable</span>
                    </label>
                  </td>
                </tr>
              ))}
              {!isLoading && extensions.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty">
                    No extensions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx>{`
        .page {
          padding: 24px 32px;
        }
        .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .save-msg {
          font-size: 12px;
          color: #787774;
        }
        .btn {
          border: 1px solid #d7d5d1;
          background: #ffffff;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
          cursor: pointer;
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .title {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
          color: #2f2f2f;
        }
        .subtitle {
          margin-top: 6px;
          font-size: 12px;
          color: #787774;
        }
        .error {
          background: rgba(235, 87, 87, 0.1);
          color: #d1242f;
          border: 1px solid rgba(235, 87, 87, 0.25);
          padding: 10px 12px;
          border-radius: 8px;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .table-wrap {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 10px;
          overflow: auto;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
        }
        thead th {
          text-align: left;
          font-size: 11px;
          letter-spacing: 0.3px;
          text-transform: uppercase;
          color: #787774;
          padding: 12px 16px;
          background: #fafaf8;
          border-bottom: 1px solid #e9e9e7;
        }
        tbody td {
          padding: 12px 16px;
          border-bottom: 1px solid #f1f1ee;
          font-size: 13px;
          color: #37352f;
          vertical-align: middle;
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        .mono {
          font-variant-numeric: tabular-nums;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
            monospace;
        }
        .empty {
          padding: 18px 16px;
          color: #787774;
          font-size: 13px;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 400;
          white-space: nowrap;
          line-height: 1.4;
          border: none;
        }
        .status-badge.status-positive {
          background-color: rgba(46, 170, 220, 0.12);
          color: #0b6e99;
        }
        .status-badge.status-neutral {
          background-color: rgba(55, 53, 47, 0.09);
          color: #37352f;
        }
        .check {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #37352f;
          user-select: none;
        }
        .check input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .th-check {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          user-select: none;
        }
        .th-check input {
          width: 14px;
          height: 14px;
          cursor: pointer;
        }
        .th-check input:disabled {
          cursor: not-allowed;
        }
      `}</style>
    </DashboardLayout>
  )
}

