'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { buildApiUrl } from '@/lib/api-helpers'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { useSelectedUser } from '@/hooks/use-selected-user'
import { useUser } from '@/hooks/use-user'
import { isSuperAdmin } from '@/lib/permissions'
import type { FreePbxSettings } from '@/types/call'
import { useQueryClient } from '@tanstack/react-query'

type MailboxItem = {
  mailbox: string
  total?: number
  inboxCount?: number
  oldCount?: number
  lastReceivedAt?: string | null
}

type VmMessage = {
  id: string
  mailbox: string
  vmContext: string
  folder: string
  msgId: string
  receivedAt?: string | null
  callerId?: string
  durationSeconds?: number | null
  recordingPath?: string | null
  transcript?: string
  analysis?: string
  status: string
  error?: string | null
}

const defaultVoicemailSettings: Pick<
  FreePbxSettings,
  'voicemail_enabled' | 'voicemail_base_path' | 'voicemail_context' | 'voicemail_folders' | 'voicemail_sync_interval_minutes'
> = {
  voicemail_enabled: false,
  voicemail_base_path: '/var/spool/asterisk/voicemail',
  voicemail_context: 'default',
  voicemail_folders: ['INBOX', 'Old'],
  voicemail_sync_interval_minutes: 5,
}

/** Format bold caller line for list: internal = "200 Eduard Akulov", external = full number and caller id */
function formatListCaller(m: VmMessage): string {
  const caller = (m.callerId || '').trim()
  const mailbox = String(m.mailbox || '').trim()
  if (!caller) return mailbox || 'Unknown'
  const match = caller.match(/^"([^"]*)"\s*<([^>]+)>$/) || caller.match(/^<([^>]+)>\s*"([^"]*)"$/)
  if (match) {
    const name = (match[1] || match[2] || '').trim()
    const number = (match[2] || match[1] || '').trim()
    if (number === mailbox || /^\d{3,5}$/.test(number)) return `${mailbox} ${name}`.trim() || caller
  }
  return caller
}

const fmtLocal = (iso: string | null | undefined, tz: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

export default function VoicemailPage() {
  const { status } = useSession()
  const { selectedUserId } = useAdminUser()
  const { data: currentUser } = useUser()
  const { data: user, isLoading: isUserLoading } = useSelectedUser()
  const queryClient = useQueryClient()

  const tz = String((user as any)?.timezone || 'UTC')

  const [mailboxes, setMailboxes] = useState<MailboxItem[]>([])
  const [selectedMailbox, setSelectedMailbox] = useState<string>('')
  const [messages, setMessages] = useState<VmMessage[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [error, setError] = useState<string>('')

  const [settingsForm, setSettingsForm] = useState({ ...defaultVoicemailSettings })
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string>('')
  const [saveMessageType, setSaveMessageType] = useState<'success' | 'error' | 'info'>('info')
  const [isClearingError, setIsClearingError] = useState(false)

  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const loadedMetadataRef = useRef<Record<string, boolean>>({})
  const [audioTimes, setAudioTimes] = useState<Record<string, { current: number; duration: number }>>({})
  const [audioLoadError, setAudioLoadError] = useState<string | null>(null)

  const toggleAudio = async (audioId: string) => {
    const audio = audioRefs.current[audioId]
    Object.entries(audioRefs.current).forEach(([id, el]) => {
      if (id !== audioId && el && !el.paused) {
        el.pause()
        el.currentTime = 0
      }
    })
    if (audio?.paused) {
      // Mark as listened before playing so the backend has Old path when we request audio (avoids race)
      const msg = messages.find((m) => m.id === audioId)
      const patchUrl = buildApiUrl(`/api/v1/integrations/freepbx/voicemail/messages/${audioId}`, selectedUserId)
      const mailboxesUrl = buildApiUrl('/api/v1/integrations/freepbx/voicemail/mailboxes-db', selectedUserId)
      setAudioLoadError(null)
      // Optimistically move to Old so the purple "new" dot disappears instantly
      if (msg?.folder === 'INBOX') {
        setMessages((prev) => prev.map((m) => (m.id === audioId ? { ...m, folder: 'Old' as const } : m)))
      }
      try {
        await apiClient.patch(patchUrl, { listened: true })
        if (msg?.mailbox) {
          setMailboxes((prev) =>
            prev.map((mb) =>
              mb.mailbox === msg.mailbox
                ? {
                    ...mb,
                    inboxCount: Math.max(0, (mb.inboxCount ?? 0) - 1),
                    oldCount: (mb.oldCount ?? 0) + 1,
                  }
                : mb
            )
          )
        }
        const { data } = await apiClient.get(mailboxesUrl)
        setMailboxes((data?.data?.mailboxes || []) as MailboxItem[])
      } catch {
        if (msg?.folder === 'INBOX') {
          setMessages((prev) => prev.map((m) => (m.id === audioId ? { ...m, folder: 'INBOX' as const } : m)))
        }
        apiClient.get(mailboxesUrl).then(({ data }) => setMailboxes((data?.data?.mailboxes || []) as MailboxItem[])).catch(() => {})
      }
      if (audio) {
        audio.play()
        setPlayingAudio(audioId)
      }
    } else if (audio) {
      audio.pause()
      setPlayingAudio(null)
    }
  }

  const handleAudioEnded = (audioId: string) => {
    if (playingAudio === audioId) setPlayingAudio(null)
    setAudioTimes((prev) => ({
      ...prev,
      [audioId]: { current: 0, duration: prev[audioId]?.duration || audioRefs.current[audioId]?.duration || 0 },
    }))
  }

  const handleTimeUpdate = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return
    setAudioTimes((prev) => ({
      ...prev,
      [audioId]: {
        current: audio.currentTime,
        duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (prev[audioId]?.duration || 0),
      },
    }))
  }

  const handleLoadedMetadata = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    loadedMetadataRef.current[audioId] = true
    setAudioTimes((prev) => {
      const d = audio.duration
      if (prev[audioId]?.duration === d) return prev
      return { ...prev, [audioId]: { current: prev[audioId]?.current || 0, duration: d } }
    })
  }

  const handleSeek = (audioId: string, value: number) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return
    audio.currentTime = value
    setAudioTimes((prev) => ({
      ...prev,
      [audioId]: { ...prev[audioId], current: value, duration: prev[audioId]?.duration || audio.duration || 0 },
    }))
  }

  const handleDurationChange = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    setAudioTimes((prev) => {
      const d = audio.duration
      if (prev[audioId]?.duration === d) return prev
      return { ...prev, [audioId]: { current: prev[audioId]?.current || 0, duration: d } }
    })
  }

  useEffect(() => {
    setPlayingAudio(null)
    setAudioLoadError(null)
  }, [messages[0]?.id])

  useEffect(() => {
    if (user?.freepbxSettings) {
      setSettingsForm({
        voicemail_enabled: user.freepbxSettings.voicemail_enabled ?? false,
        voicemail_base_path: user.freepbxSettings.voicemail_base_path || '/var/spool/asterisk/voicemail',
        voicemail_context: user.freepbxSettings.voicemail_context || 'default',
        voicemail_folders: user.freepbxSettings.voicemail_folders || ['INBOX', 'Old'],
        voicemail_sync_interval_minutes: user.freepbxSettings.voicemail_sync_interval_minutes ?? 5,
      })
    }
  }, [user?.freepbxSettings])

  const isAllowed = useMemo(() => isSuperAdmin(currentUser), [currentUser])

  useEffect(() => {
    if (!isAllowed) return
    // On page load, fetch from DB only (fast). Background jobs/manual sync will update DB.
    let cancelled = false
    async function load() {
      setIsSyncing(true)
      setError('')
      try {
        const url = buildApiUrl('/api/v1/integrations/freepbx/voicemail/mailboxes-db', selectedUserId)
        const { data } = await apiClient.get(url)
        if (cancelled) return
        setMailboxes((data?.data?.mailboxes || []) as MailboxItem[])
      } catch (e: any) {
        if (cancelled) return
        const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to sync voicemail'
        setError(String(msg))
      } finally {
        if (!cancelled) setIsSyncing(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isAllowed, selectedUserId])

  useEffect(() => {
    if (!selectedMailbox) return
    let cancelled = false
    async function loadMessages() {
      setIsLoadingMessages(true)
      setError('')
      try {
        const url = buildApiUrl(
          `/api/v1/integrations/freepbx/voicemail/messages-db?mailbox=${encodeURIComponent(selectedMailbox)}&limit=200&offset=0`,
          selectedUserId
        )
        const { data } = await apiClient.get(url)
        const raw = (data?.data?.messages || []) as VmMessage[]
        const sorted = [...raw].sort((a, b) => {
          const aNew = a.folder === 'INBOX' ? 1 : 0
          const bNew = b.folder === 'INBOX' ? 1 : 0
          if (bNew !== aNew) return bNew - aNew
          const at = a.receivedAt ? new Date(a.receivedAt).getTime() : 0
          const bt = b.receivedAt ? new Date(b.receivedAt).getTime() : 0
          return bt - at
        })
        if (cancelled) return
        setMessages(sorted)
        setSelectedMessageId((prev) => {
          const ids = new Set(sorted.map((m) => m.id))
          if (prev && ids.has(prev)) return prev
          return sorted[0]?.id ?? null
        })
      } catch (e: any) {
        if (cancelled) return
        const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to load voicemail messages'
        setError(String(msg))
      } finally {
        if (!cancelled) setIsLoadingMessages(false)
      }
    }
    loadMessages()
    return () => {
      cancelled = true
    }
  }, [selectedMailbox, selectedUserId])

  const selectedMsg = useMemo(() => {
    if (selectedMessageId) {
      const found = messages.find((m) => m.id === selectedMessageId)
      if (found) return found
    }
    return messages[0] || null
  }, [messages, selectedMessageId])

  useEffect(() => {
    const msg = selectedMsg
    if (msg?.id && msg.durationSeconds != null && Number.isFinite(msg.durationSeconds) && msg.durationSeconds > 0) {
      setAudioTimes((prev) => {
        if (prev[msg.id]?.duration && prev[msg.id]!.duration > 0) return prev
        return { ...prev, [msg.id]: { current: prev[msg.id]?.current || 0, duration: msg.durationSeconds! } }
      })
    }
  }, [selectedMsg?.id, selectedMsg?.durationSeconds])

  if (status === 'loading' || isUserLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Voicemail</h1>
          <p className="page-subtitle">Loading...</p>
        </div>
      </DashboardLayout>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (!isAllowed) {
    redirect('/dashboard')
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    setError('')
    try {
      const url = buildApiUrl('/api/v1/integrations/freepbx/voicemail/sync', selectedUserId)
      await apiClient.post(url)
      // Refresh DB mailboxes after sync completes (sync may become async later; this is still safe).
      const dbUrl = buildApiUrl('/api/v1/integrations/freepbx/voicemail/mailboxes-db', selectedUserId)
      const { data } = await apiClient.get(dbUrl)
      setMailboxes((data?.data?.mailboxes || []) as MailboxItem[])
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to sync voicemail'
      setError(String(msg))
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSaveSettings = async () => {
    setIsSaving(true)
    setSaveMessage('')
    try {
      const payload: any = {
        freepbxSettings: {
          voicemail_enabled: Boolean(settingsForm.voicemail_enabled),
          voicemail_base_path: String(settingsForm.voicemail_base_path || '/var/spool/asterisk/voicemail'),
          voicemail_context: String(settingsForm.voicemail_context || 'default'),
          voicemail_folders: Array.isArray(settingsForm.voicemail_folders) ? settingsForm.voicemail_folders : ['INBOX', 'Old'],
          voicemail_sync_interval_minutes: Number(settingsForm.voicemail_sync_interval_minutes) || 5,
        },
      }
      const url = buildApiUrl('/api/v1/user/preferences', selectedUserId)
      await apiClient.patch(url, payload)
      setSaveMessage('Voicemail settings saved.')
      setSaveMessageType('success')
      queryClient.invalidateQueries({ queryKey: ['user'] })
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Failed to save settings'
      setSaveMessage(String(msg))
      setSaveMessageType('error')
    } finally {
      setIsSaving(false)
      setTimeout(() => setSaveMessage(''), 4000)
    }
  }

  const handleClearLastError = async () => {
    setIsClearingError(true)
    try {
      const url = buildApiUrl('/api/v1/integrations/freepbx/voicemail/clear-last-error', selectedUserId)
      await apiClient.post(url)
      queryClient.invalidateQueries({ queryKey: ['user'] })
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to clear'
      setSaveMessage(String(msg))
      setSaveMessageType('error')
      setTimeout(() => setSaveMessage(''), 4000)
    } finally {
      setIsClearingError(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (!selectedMsg?.id) return
    if (!confirm(`Delete voicemail ${selectedMsg.folder}/${selectedMsg.msgId}? This will delete it from the PBX and remove it from the app.`)) {
      return
    }
    setIsDeleting(true)
    setError('')
    try {
      const url = buildApiUrl(`/api/v1/integrations/freepbx/voicemail/messages/${selectedMsg.id}`, selectedUserId)
      await apiClient.delete(url)
      const nextList = messages.filter((m) => m.id !== selectedMsg.id)
      setMessages(nextList)
      setSelectedMessageId((prev) => {
        if (prev !== selectedMsg.id) return prev
        return nextList[0]?.id ?? null
      })
      // Refresh mailbox counts from DB
      const dbUrl = buildApiUrl('/api/v1/integrations/freepbx/voicemail/mailboxes-db', selectedUserId)
      const { data } = await apiClient.get(dbUrl)
      setMailboxes((data?.data?.mailboxes || []) as MailboxItem[])
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Failed to delete voicemail'
      setError(String(msg))
    } finally {
      setIsDeleting(false)
    }
  }

  const lastSync = fmtLocal((user as any)?.freepbxSettings?.voicemail_last_sync_at, tz)
  const nextSync = fmtLocal((user as any)?.freepbxSettings?.voicemail_next_sync_at, tz)
  const lastResult = (user as any)?.freepbxSettings?.voicemail_last_result

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Voicemail</h1>
            <p className="page-subtitle">FreePBX voicemail messages (per selected user)</p>
          </div>
          <div className="header-actions">
            <button type="button" className="ghost-btn" onClick={handleSyncNow} disabled={isSyncing}>
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>

        {error && <div className="setting-hint error">{error}</div>}

        <div className="settings-section">
          <div className="settings-card">
            <div className="setting-item" style={{ paddingTop: 0 }}>
              <div className="setting-label">Mailboxes</div>
              <div className="mailbox-grid">
                {mailboxes.length === 0 ? (
                  <div className="setting-hint">No voicemail messages found (or not synced yet).</div>
                ) : (
                  mailboxes.map((m) => (
                    <button
                      key={m.mailbox}
                      type="button"
                      className={`mailbox-pill ${selectedMailbox === m.mailbox ? 'active' : ''}`}
                      onClick={() => setSelectedMailbox(m.mailbox)}
                    >
                      <div className="mailbox-pill-title">
                        {[m.mailbox, ((user as any)?.fullName || (user as any)?.email || '').trim()].filter(Boolean).join(' ')}
                      </div>
                      <div className="mailbox-pill-sub">
                        {(m.inboxCount ?? 0) > 0 ? (
                          <>
                            <span className="mailbox-pill-new">{(m.inboxCount ?? 0).toLocaleString()} new</span>
                            <span> • {(m.oldCount ?? 0).toLocaleString()} old</span>
                          </>
                        ) : (
                          <>{(m.inboxCount ?? 0).toLocaleString()} new • {(m.oldCount ?? 0).toLocaleString()} old</>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="setting-hint" style={{ marginTop: 10 }}>
                {selectedMailbox
                  ? isLoadingMessages
                    ? 'Loading messages…'
                    : `${messages.length.toLocaleString()} messages loaded for mailbox ${selectedMailbox}.`
                  : 'Select a mailbox to view messages.'}
              </div>
            </div>

            {selectedMailbox && (
              <div className="setting-item">
                <div className="setting-label">Messages</div>
                {messages.length === 0 ? (
                  <div className="setting-hint">No messages found.</div>
                ) : (
                  <div className="messages-grid">
                    <div className="messages-list">
                      {messages.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`message-row ${selectedMsg?.id === m.id ? 'active' : ''}`}
                          onClick={() => setSelectedMessageId(m.id)}
                        >
                          <div className="message-title">
                            {m.folder === 'INBOX' && <span className="vm-new-indicator" aria-label="New" />}
                            {formatListCaller(m)}
                          </div>
                          <div className="message-sub">
                            {fmtLocal(m.receivedAt, tz)}
                            {m.durationSeconds != null ? ` • ${m.durationSeconds}s` : ''}
                            {` • ${m.folder}/${m.msgId}`}
                          </div>
                          {(m.status === 'pending' || m.status === 'processing') && (
                            <div className="message-status-inline">{m.status === 'processing' ? 'transcribing' : m.status}</div>
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="message-detail">
                      <div className="detail-title">
                        {selectedMsg ? formatListCaller(selectedMsg) : '—'}
                      </div>
                      <div className="detail-meta">
                        {selectedMsg
                          ? `${fmtLocal(selectedMsg.receivedAt, tz)}${selectedMsg.durationSeconds != null ? ` • ${selectedMsg.durationSeconds}s` : ''} • ${selectedMsg.folder}/${selectedMsg.msgId}`
                          : '—'}
                      </div>
                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="button" className="ghost-btn" onClick={handleDeleteSelected} disabled={isDeleting}>
                          {isDeleting ? 'Deleting…' : 'Delete voicemail'}
                        </button>
                      </div>

                      {selectedMsg?.recordingPath ? (() => {
                        const detailAudioId = selectedMsg.id
                        return (
                          <div key={detailAudioId} className="voicemail-audio-wrap">
                            <div className="audio-player-container">
                              <button
                                type="button"
                                className={`audio-play-btn detail-audio-btn ${playingAudio === detailAudioId ? 'playing' : ''}`}
                                onClick={() => toggleAudio(detailAudioId)}
                                aria-label="Play audio"
                              >
                                {playingAudio === detailAudioId ? (
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                  </svg>
                                ) : (
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                )}
                              </button>
                              <div className="audio-controls">
                                <div className="audio-time-display">
                                  <span className="time-current">
                                    {(() => {
                                      const current = audioTimes[detailAudioId]?.current ?? 0
                                      const mins = Math.floor(current / 60)
                                      const secs = Math.floor(current % 60)
                                      return `${mins}:${secs.toString().padStart(2, '0')}`
                                    })()}
                                  </span>
                                  <span className="time-separator">/</span>
                                  <span className="time-duration">
                                    {(() => {
                                      const duration = audioTimes[detailAudioId]?.duration ?? 0
                                      if (!Number.isFinite(duration) || duration <= 0) return '--:--'
                                      const mins = Math.floor(duration / 60)
                                      const secs = Math.floor(duration % 60)
                                      return `${mins}:${secs.toString().padStart(2, '0')}`
                                    })()}
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  className="audio-seek-bar"
                                  min={0}
                                  max={audioTimes[detailAudioId]?.duration || 100}
                                  value={audioTimes[detailAudioId]?.current || 0}
                                  onChange={(e) => handleSeek(detailAudioId, parseFloat(e.target.value))}
                                  step="0.1"
                                  disabled={
                                    !audioTimes[detailAudioId]?.duration ||
                                    audioTimes[detailAudioId]!.duration <= 0
                                  }
                                />
                              </div>
                            </div>
                            <audio
                              key={detailAudioId}
                              ref={(el) => {
                                if (el) {
                                  audioRefs.current[detailAudioId] = el
                                  if (el.readyState >= 1 && !loadedMetadataRef.current[detailAudioId]) handleLoadedMetadata(detailAudioId)
                                } else {
                                  delete audioRefs.current[detailAudioId]
                                  delete loadedMetadataRef.current[detailAudioId]
                                }
                              }}
                              preload="none"
                              onEnded={() => handleAudioEnded(detailAudioId)}
                              onTimeUpdate={() => handleTimeUpdate(detailAudioId)}
                              onLoadedMetadata={() => handleLoadedMetadata(detailAudioId)}
                              onDurationChange={() => handleDurationChange(detailAudioId)}
                              onError={() => setAudioLoadError('Unable to load audio. Check your connection or try again.')}
                            >
                              <source src={buildApiUrl(`/api/voicemail-audio/${selectedMsg.id}`, selectedUserId)} type="audio/wav" />
                            </audio>
                            {audioLoadError && (
                              <div className="setting-hint error" style={{ marginTop: 8 }}>{audioLoadError}</div>
                            )}
                          </div>
                        )
                      })() : (
                        <div className="setting-hint voicemail-no-audio">No recording available for this voicemail.</div>
                      )}

                      <div className="detail-block">
                        <div className="detail-label">Transcript</div>
                        <div className="detail-box">{selectedMsg?.transcript ? selectedMsg.transcript : 'Pending…'}</div>
                      </div>
                      {selectedMsg?.error && (
                        <div className="setting-hint error" style={{ marginTop: 10 }}>
                          Error: {selectedMsg.error}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Settings section below voicemail content (superadmin-only) */}
        <div className="settings-section">
          <div className="settings-card">
            <div className="setting-item" style={{ paddingTop: 0 }}>
              <div className="setting-label">Voicemail Settings (Superadmin)</div>

              {saveMessage && <div className={`setting-hint ${saveMessageType === 'error' ? 'error' : ''}`}>{saveMessage}</div>}

              <div className="settings-grid">
                <div>
                  <div className="setting-label">Enable voicemail transcribing</div>
                  <label className="toggle-control">
                    <input
                      type="checkbox"
                      checked={Boolean(settingsForm.voicemail_enabled)}
                      onChange={(e) => setSettingsForm((p) => ({ ...p, voicemail_enabled: e.target.checked }))}
                    />
                    <span className="toggle-slider" />
                    <span className="toggle-label">{settingsForm.voicemail_enabled ? 'Enabled' : 'Disabled'}</span>
                  </label>
                </div>

                <div>
                  <div className="setting-label">Base path</div>
                  <input
                    type="text"
                    className="text-input"
                    value={String(settingsForm.voicemail_base_path || '')}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, voicemail_base_path: e.target.value }))}
                    disabled={!settingsForm.voicemail_enabled}
                  />
                  <div className="setting-hint">Default: /var/spool/asterisk/voicemail</div>
                </div>

                <div>
                  <div className="setting-label">Context</div>
                  <input
                    type="text"
                    className="text-input"
                    value={String(settingsForm.voicemail_context || '')}
                    onChange={(e) => setSettingsForm((p) => ({ ...p, voicemail_context: e.target.value }))}
                    disabled={!settingsForm.voicemail_enabled}
                  />
                  <div className="setting-hint">Default: default</div>
                </div>

                <div>
                  <div className="setting-label">Sync interval (minutes)</div>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={1440}
                    value={Number(settingsForm.voicemail_sync_interval_minutes || 5)}
                    onChange={(e) =>
                      setSettingsForm((p) => ({ ...p, voicemail_sync_interval_minutes: parseInt(e.target.value, 10) || 5 }))
                    }
                    disabled={!settingsForm.voicemail_enabled}
                  />
                  <div className="setting-hint">Default: 5</div>
                </div>
              </div>

              <div className="setting-hint" style={{ marginTop: 10 }}>
                <strong>Folders:</strong>{' '}
                {['INBOX', 'Old', 'Urgent'].map((f) => {
                  const checked = (settingsForm.voicemail_folders || []).includes(f)
                  return (
                    <label key={f} style={{ marginRight: 12 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSettingsForm((p) => {
                            const curr = Array.isArray(p.voicemail_folders) ? p.voicemail_folders : []
                            const next = e.target.checked ? Array.from(new Set([...curr, f])) : curr.filter((x) => x !== f)
                            return { ...p, voicemail_folders: next }
                          })
                        }}
                        disabled={!settingsForm.voicemail_enabled}
                        style={{ marginRight: 6 }}
                      />
                      {f}
                    </label>
                  )
                })}
              </div>

              <div className="setting-hint" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
                <strong>Sync schedule:</strong> {lastSync ? `Last: ${lastSync}` : 'Last: —'} • {nextSync ? `Next: ${nextSync}` : 'Next: —'}
                {lastResult?.error ? (
                  <span className="setting-hint error">
                    {' '}
                    • Last error: {String(lastResult.error)}{' '}
                    <button
                      type="button"
                      className="dismiss-error-btn"
                      onClick={handleClearLastError}
                      disabled={isClearingError}
                    >
                      {isClearingError ? '…' : 'Dismiss'}
                    </button>
                  </span>
                ) : null}
              </div>

              <div className="form-actions" style={{ marginTop: 12 }}>
                <button type="button" className="primary-btn" onClick={handleSaveSettings} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save voicemail settings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .settings-container {
          width: 100%;
          padding: 18px 32px 32px;
        }
        .page-header {
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        .page-title {
          font-size: 17px;
          font-weight: 600;
          color: #2f2f2f;
          margin-bottom: 4px;
          letter-spacing: -0.2px;
        }
        .page-subtitle {
          color: #787774;
          font-size: 13px;
        }
        .header-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .settings-section {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 24px;
          margin-bottom: 24px;
        }
        .settings-card {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .setting-item {
          padding: 18px 0;
          border-bottom: 1px solid #f1f1ef;
        }
        .setting-item:last-child {
          padding-bottom: 0;
          border-bottom: none;
        }
        .setting-label {
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 8px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .setting-hint {
          font-size: 12px;
          color: #787774;
          line-height: 1.5;
        }
        .setting-hint.error {
          color: #c0362c;
        }
        .dismiss-error-btn {
          margin-left: 8px;
          padding: 2px 8px;
          font-size: 12px;
          background: transparent;
          border: 1px solid #c0362c;
          color: #c0362c;
          border-radius: 4px;
          cursor: pointer;
        }
        .dismiss-error-btn:hover:not(:disabled) {
          background: rgba(192, 54, 44, 0.1);
        }
        .dismiss-error-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-top: 12px;
        }
        .text-input {
          width: 100%;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 10px 12px;
          background: #ffffff;
          font-size: 13px;
        }
        .ghost-btn {
          padding: 10px 20px;
          border: 1px solid #d7d5d1;
          background: #fff;
          border-radius: 6px;
          font-size: 14px;
          color: #37352f;
          cursor: pointer;
          min-width: 110px;
          text-align: center;
        }
        .ghost-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .primary-btn {
          background: var(--app-accent);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 12px 20px;
          font-size: 14px;
          cursor: pointer;
        }
        .primary-btn:hover:not(:disabled) {
          background: var(--app-accent-hover);
        }
        .primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .form-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
        .mailbox-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 10px;
        }
        .mailbox-pill {
          text-align: left;
          border: 1px solid #e9e9e7;
          background: #fff;
          border-radius: 8px;
          padding: 10px 12px;
          cursor: pointer;
        }
        .mailbox-pill.active {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .mailbox-pill-title {
          font-weight: 700;
          font-size: 14px;
          color: #37352f;
        }
        .mailbox-pill-sub {
          font-size: 12px;
          color: #787774;
          margin-top: 4px;
        }
        .mailbox-pill-new {
          color: var(--app-accent);
          font-size: 12px;
          font-weight: 700;
        }
        .messages-grid {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 14px;
        }
        .messages-list {
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          overflow: hidden;
          background: #fff;
          max-height: 520px;
          overflow-y: auto;
        }
        .message-row {
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          border-bottom: 1px solid #f1f1ef;
          background: #fff;
          cursor: pointer;
        }
        .message-row.active {
          background: #f5f9ff;
        }
        .message-title {
          font-weight: 700;
          font-size: 13px;
          color: #37352f;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .vm-new-indicator {
          flex-shrink: 0;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--app-accent);
        }
        .message-sub {
          font-size: 12px;
          color: #787774;
          margin-top: 3px;
        }
        .message-status-inline {
          margin-top: 3px;
          font-size: 12px;
          color: #787774;
          text-transform: lowercase;
        }
        .message-detail {
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          background: #fff;
          padding: 12px 14px;
        }
        .detail-title {
          font-weight: 800;
          font-size: 14px;
          color: #37352f;
        }
        .detail-meta {
          margin-top: 6px;
          font-size: 12px;
          color: #787774;
          line-height: 1.6;
        }
        .detail-block {
          margin-top: 14px;
        }
        .detail-label {
          font-size: 12px;
          color: #37352f;
          font-weight: 800;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .detail-box {
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 13px;
          color: #37352f;
          white-space: pre-wrap;
          min-height: 76px;
          background: #fff;
        }
        .voicemail-audio-wrap {
          margin-top: 12px;
        }
        .voicemail-no-audio {
          margin-top: 12px;
        }
        .audio-player-container {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .audio-play-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid var(--app-accent);
          background: var(--app-accent);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
          padding: 0;
          outline: none;
          color: #ffffff;
        }
        .audio-play-btn:hover {
          background: var(--app-accent-hover);
          border-color: var(--app-accent-hover);
        }
        .audio-play-btn.playing {
          background: var(--app-accent-hover);
          border-color: var(--app-accent-hover);
        }
        .audio-play-btn svg {
          width: 14px;
          height: 14px;
        }
        .audio-controls {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }
        .audio-time-display {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--app-accent);
          font-variant-numeric: tabular-nums;
          min-width: 85px;
        }
        .time-current,
        .time-separator,
        .time-duration {
          color: var(--app-accent);
        }
        .time-current {
          font-weight: 500;
        }
        .audio-seek-bar {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: #e9e9e7;
          outline: none;
          cursor: pointer;
        }
        .audio-seek-bar::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--app-accent);
          cursor: pointer;
        }
        .audio-seek-bar::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--app-accent);
          border: none;
          cursor: pointer;
        }
        .toggle-control {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .toggle-control input {
          display: none;
        }
        .toggle-slider {
          width: 36px;
          height: 20px;
          border-radius: 999px;
          background: #e9e9e7;
          position: relative;
          transition: all 0.2s;
        }
        .toggle-slider:before {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          background: #fff;
          border-radius: 999px;
          transition: all 0.2s;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
        }
        .toggle-control input:checked + .toggle-slider {
          background: var(--app-accent);
        }
        .toggle-control input:checked + .toggle-slider:before {
          transform: translateX(16px);
        }
        .toggle-label {
          font-size: 13px;
          color: #37352f;
          font-weight: 700;
        }
        @media (max-width: 980px) {
          .messages-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

