'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { useFreepbxCdrTestConnection, useCdrStatus, useCdrSync, useFreepbxSshTestConnection } from '@/hooks/use-calls'
import type { FreePbxSettings } from '@/types/call'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { buildApiUrl } from '@/lib/api-helpers'
import { useSelectedUser } from '@/hooks/use-selected-user'
import { useUser } from '@/hooks/use-user'

const defaultSettings: FreePbxSettings = {
  enabled: false,
  mysql_host: '',
  mysql_port: 3306,
  mysql_username: '',
  mysql_database: 'asteriskcdrdb',
  hasMysqlPassword: false,
  ssh_host: '',
  ssh_port: 22,
  ssh_username: '',
  ssh_base_path: '/var/spool/asterisk/monitor',
  hasSshPassword: false,
  hasSshPrivateKey: false,
  retention_enabled: false,
  retention_days: 30,
  retention_run_time: '02:00',
}

export default function FreePbxSettingsPage() {
  const { data: session, status } = useSession()
  const { selectedUserId } = useAdminUser()
  const { data: currentUser } = useUser()
  const { data: user, isLoading: isUserLoading, error: userError } = useSelectedUser()
  const queryClient = useQueryClient()

  const { data: cdrStatusData, isLoading: isCdrStatusLoading } = useCdrStatus(selectedUserId)
  const syncMutation = useCdrSync(selectedUserId)
  const testMysqlConnectionMutation = useFreepbxCdrTestConnection()
  const testSshConnectionMutation = useFreepbxSshTestConnection()

  const [form, setForm] = useState({
    ...defaultSettings,
    mysql_password: '',
    mysqlPasswordChanged: false,
    ssh_password: '',
    sshPasswordChanged: false,
    ssh_private_key: '',
    sshPrivateKeyChanged: false,
    ssh_passphrase: '',
    sshPassphraseChanged: false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')
  const [recordingsStats, setRecordingsStats] = useState<null | { basePath: string; fileCount: number; sizeMB: number; firstDay?: string | null; lastDay?: string | null }>(null)
  const [isLoadingRecordingsStats, setIsLoadingRecordingsStats] = useState(false)
  const [recordingsStatsError, setRecordingsStatsError] = useState<string>('')

  const [showMysqlPassword, setShowMysqlPassword] = useState(false)
  const [isLoadingMysqlPassword, setIsLoadingMysqlPassword] = useState(false)
  const [mysqlPasswordRevealError, setMysqlPasswordRevealError] = useState<string>('')

  useEffect(() => {
    if (user?.freepbxSettings) {
      setShowMysqlPassword(false)
      setIsLoadingMysqlPassword(false)
      setMysqlPasswordRevealError('')
      setForm({
        enabled: user.freepbxSettings.enabled ?? false,
        mysql_host: user.freepbxSettings.mysql_host || '',
        mysql_port: user.freepbxSettings.mysql_port || 3306,
        mysql_username: user.freepbxSettings.mysql_username || '',
        mysql_database: user.freepbxSettings.mysql_database || 'asteriskcdrdb',
        hasMysqlPassword: user.freepbxSettings.hasMysqlPassword ?? false,
        ssh_host: user.freepbxSettings.ssh_host || '',
        ssh_port: user.freepbxSettings.ssh_port || 22,
        ssh_username: user.freepbxSettings.ssh_username || '',
        ssh_base_path: user.freepbxSettings.ssh_base_path || '/var/spool/asterisk/monitor',
        hasSshPassword: user.freepbxSettings.hasSshPassword ?? false,
        hasSshPrivateKey: user.freepbxSettings.hasSshPrivateKey ?? false,
        retention_enabled: user.freepbxSettings.retention_enabled ?? false,
        retention_days: user.freepbxSettings.retention_days ?? 30,
        retention_run_time: user.freepbxSettings.retention_run_time || '02:00',
        mysql_password: '',
        mysqlPasswordChanged: false,
        ssh_password: '',
        sshPasswordChanged: false,
        ssh_private_key: '',
        sshPrivateKeyChanged: false,
        ssh_passphrase: '',
        sshPassphraseChanged: false,
      })
    }
  }, [user?.freepbxSettings])

  const parseYmd = (ymd: string | null | undefined) => {
    const s = String(ymd || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const [yyyy, mm, dd] = s.split('-')
    const y = Number.parseInt(yyyy, 10)
    const m = Number.parseInt(mm, 10)
    const d = Number.parseInt(dd, 10)
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
    if (m < 1 || m > 12) return null
    if (d < 1 || d > 31) return null
    return { y, m, d, yyyy, mm, dd }
  }

  const formatDayDisplay = (ymd: string | null | undefined) => {
    const parsed = parseYmd(ymd)
    if (!parsed) return null
    return `${parsed.mm}/${parsed.dd}/${parsed.yyyy.slice(2)}`
  }

  const computeInclusiveDays = (firstYmd: string | null | undefined, lastYmd: string | null | undefined) => {
    const a = parseYmd(firstYmd)
    const b = parseYmd(lastYmd)
    if (!a || !b) return null
    const startUtc = Date.UTC(a.y, a.m - 1, a.d)
    const endUtc = Date.UTC(b.y, b.m - 1, b.d)
    if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc) || endUtc < startUtc) return null
    return Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000)) + 1
  }

  const formatUtcIsoInTz = (isoUtc: string | null | undefined) => {
    const s = String(isoUtc || '').trim()
    if (!s) return null
    const dt = new Date(s)
    if (Number.isNaN(dt.getTime())) return null

    const tz = String((user as any)?.timezone || 'UTC')

    const makeFormatter = (timeZone: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })

    const formatWith = (timeZone: string) => {
      const parts = makeFormatter(timeZone).formatToParts(dt)
      const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
      const mm = get('month')
      const dd = get('day')
      const yy = get('year')
      const hh = get('hour')
      const min = get('minute')
      const ap = get('dayPeriod')
      if (!mm || !dd || !yy || !hh || !min || !ap) return null
      return `${mm}/${dd}/${yy} ${hh}:${min} ${ap}`
    }

    try {
      return formatWith(tz) || formatWith('UTC')
    } catch {
      return formatWith('UTC')
    }
  }

  const handleToggleShowMysqlPassword = async () => {
    setMysqlPasswordRevealError('')

    // Hide: just re-mask; keep current value so user can continue editing/saving.
    if (showMysqlPassword) {
      setShowMysqlPassword(false)
      return
    }

    // Show: if we already have a value (typed or previously revealed), just unmask.
    if (form.mysql_password) {
      setShowMysqlPassword(true)
      return
    }

    // If there is no saved password, there's nothing to fetch.
    if (!form.hasMysqlPassword) {
      setShowMysqlPassword(true)
      return
    }

    // Fetch saved password on-demand (super admin only).
    setIsLoadingMysqlPassword(true)
    try {
      const url = buildApiUrl('/api/v1/user/freepbx/mysql-password', selectedUserId)
      const { data } = await apiClient.get(url)
      const password = data?.data?.mysql_password
      setForm((prev) => ({
        ...prev,
        mysql_password: typeof password === 'string' ? password : '',
      }))
      setShowMysqlPassword(true)
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to reveal saved password'
      setMysqlPasswordRevealError(String(msg))
      setShowMysqlPassword(false)
    } finally {
      setIsLoadingMysqlPassword(false)
    }
  }

  // Fetch recordings folder stats once when this page loads (and when switching selected user)
  useEffect(() => {
    const sshCfg = user?.freepbxSettings
    const hasSshCreds =
      Boolean(sshCfg?.ssh_host) &&
      Boolean(sshCfg?.ssh_username) &&
      (Boolean(sshCfg?.hasSshPassword) || Boolean(sshCfg?.hasSshPrivateKey))

    if (!hasSshCreds) {
      setRecordingsStats(null)
      setRecordingsStatsError('')
      setIsLoadingRecordingsStats(false)
      return
    }

    let cancelled = false
    async function load() {
      setIsLoadingRecordingsStats(true)
      setRecordingsStatsError('')
      try {
        const url = buildApiUrl('/api/v1/integrations/freepbx/recordings-stats', selectedUserId)
        const { data } = await apiClient.get(url)
        if (cancelled) return
        setRecordingsStats({
          basePath: data?.data?.basePath || sshCfg?.ssh_base_path || '/var/spool/asterisk/monitor',
          fileCount: Number(data?.data?.fileCount) || 0,
          sizeMB: Number(data?.data?.sizeMB) || 0,
          firstDay: data?.data?.firstDay ?? null,
          lastDay: data?.data?.lastDay ?? null,
        })
      } catch (err: any) {
        if (cancelled) return
        const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Failed to load folder stats'
        setRecordingsStats(null)
        setRecordingsStatsError(String(msg))
      } finally {
        if (!cancelled) setIsLoadingRecordingsStats(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [selectedUserId, user?.id, user?.freepbxSettings?.ssh_host, user?.freepbxSettings?.ssh_username, user?.freepbxSettings?.ssh_base_path, user?.freepbxSettings?.hasSshPassword, user?.freepbxSettings?.hasSshPrivateKey])

  if (status === 'loading' || isUserLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">FreePBX Integration</h1>
          <p className="page-subtitle">Loading...</p>
        </div>
      </DashboardLayout>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (userError) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">FreePBX Integration</h1>
          <p className="page-subtitle">Unable to load user profile. Please refresh and try again.</p>
        </div>
      </DashboardLayout>
    )
  }

  const handleFieldChange = (key: string, value: string | number | boolean) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleMysqlPasswordChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      mysql_password: value,
      mysqlPasswordChanged: true,
    }))
  }

  const handleClearMysqlPassword = () => {
    setForm((prev) => ({
      ...prev,
      mysql_password: '',
      mysqlPasswordChanged: true,
      hasMysqlPassword: false,
    }))
  }

  const handleSshPasswordChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      ssh_password: value,
      sshPasswordChanged: true,
    }))
  }

  const handleClearSshPassword = () => {
    setForm((prev) => ({
      ...prev,
      ssh_password: '',
      sshPasswordChanged: true,
      hasSshPassword: false,
    }))
  }

  const handleSshPrivateKeyChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      ssh_private_key: value,
      sshPrivateKeyChanged: true,
    }))
  }

  const handleClearSshPrivateKey = () => {
    setForm((prev) => ({
      ...prev,
      ssh_private_key: '',
      sshPrivateKeyChanged: true,
      hasSshPrivateKey: false,
    }))
  }

  const handleSshPassphraseChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      ssh_passphrase: value,
      sshPassphraseChanged: true,
    }))
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')

    try {
      const payload: any = {
        freepbxSettings: {
          enabled: form.enabled,
          mysql_host: form.mysql_host,
          mysql_port: Number(form.mysql_port),
          mysql_username: form.mysql_username,
          mysql_database: form.mysql_database,
          ssh_host: form.ssh_host,
          ssh_port: Number(form.ssh_port) || 22,
          ssh_username: form.ssh_username,
          ssh_base_path: form.ssh_base_path || '/var/spool/asterisk/monitor',
          retention_enabled: Boolean(form.retention_enabled),
          retention_days: Number(form.retention_days) || 30,
          retention_run_time: String(form.retention_run_time || '02:00'),
        },
      }

      if (form.mysqlPasswordChanged) {
        payload.freepbxSettings.mysql_password = form.mysql_password
      }

      if (form.sshPasswordChanged) {
        payload.freepbxSettings.ssh_password = form.ssh_password
      }

      if (form.sshPrivateKeyChanged) {
        payload.freepbxSettings.ssh_private_key = form.ssh_private_key
      }

      if (form.sshPassphraseChanged) {
        payload.freepbxSettings.ssh_passphrase = form.ssh_passphrase
      }

      const url = buildApiUrl('/api/v1/user/preferences', selectedUserId)
      const response = await apiClient.patch(url, payload)

      if (response.data.success) {
        setMessage('FreePBX settings saved successfully.')
        setMessageType('success')
        queryClient.invalidateQueries({ queryKey: ['user'] })
        queryClient.invalidateQueries({ queryKey: ['freepbx-status'] })
        setForm((prev) => ({
          ...prev,
          mysql_password: '',
          mysqlPasswordChanged: false,
          hasMysqlPassword: Boolean(form.mysql_password || response.data.data?.freepbxSettings?.hasMysqlPassword),
          ssh_password: '',
          sshPasswordChanged: false,
          hasSshPassword: Boolean(form.ssh_password || response.data.data?.freepbxSettings?.hasSshPassword),
          ssh_private_key: '',
          sshPrivateKeyChanged: false,
          hasSshPrivateKey: Boolean(form.ssh_private_key || response.data.data?.freepbxSettings?.hasSshPrivateKey),
          ssh_passphrase: '',
          sshPassphraseChanged: false,
        }))
      }
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Failed to save FreePBX settings.'
      setMessage(msg)
      setMessageType('error')
    } finally {
      setIsSaving(false)
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const handleTestMysqlConnection = async () => {
    setMessage('')
    try {
      await testMysqlConnectionMutation.mutateAsync()
      setMessage('Successfully connected to FreePBX MySQL database.')
      setMessageType('success')
    } catch (error: any) {
      const msg = error.response?.data?.message || 'MySQL connection test failed.'
      setMessage(msg)
      setMessageType('error')
    } finally {
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const handleTestSshConnection = async () => {
    setMessage('')
    try {
      await testSshConnectionMutation.mutateAsync()
      setMessage('SSH connection successful.')
      setMessageType('success')
    } catch (error: any) {
      const msg = error.response?.data?.message || 'SSH connection test failed.'
      setMessage(msg)
      setMessageType('error')
    } finally {
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const handleManualSync = () => {
    setMessage('')
    syncMutation.mutate(undefined, {
      onSuccess: () => {
        setMessage('Manual sync started. New recordings will appear shortly.')
        setMessageType('success')
        queryClient.invalidateQueries({ queryKey: ['freepbx-status'] })
        queryClient.invalidateQueries({ queryKey: ['calls'] })
      },
      onError: (error: any) => {
        const msg = error.response?.data?.message || 'Failed to start sync.'
        setMessage(msg)
        setMessageType('error')
      },
      onSettled: () => {
        setTimeout(() => setMessage(''), 4000)
      },
    })
  }

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">FreePBX Integration</h1>
            <p className="page-subtitle">
              Connect your PBX recordings so they can be transcribed and analyzed alongside Twilio calls.
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={handleTestMysqlConnection}
              disabled={testMysqlConnectionMutation.isPending || (!form.mysql_username && !user?.freepbxSettings?.mysql_username)}
            >
              {testMysqlConnectionMutation.isPending ? 'Testing MySQL...' : 'Test MySQL'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={handleTestSshConnection}
              disabled={testSshConnectionMutation.isPending}
            >
              {testSshConnectionMutation.isPending ? 'Testing SSH...' : 'Test SSH'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={handleManualSync}
              disabled={syncMutation.isPending || (!form.mysql_username && !user?.freepbxSettings?.mysql_username)}
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>

        <form className="settings-section" onSubmit={handleSave}>
          {message && (
            <div className={`settings-message ${messageType}`}>
              {message}
            </div>
          )}

          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">Integration Status</div>
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => handleFieldChange('enabled', e.target.checked)}
                />
                <span className="toggle-slider" />
                <span className="toggle-label">
                  {form.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
              <div className="setting-hint">
                When enabled with both MySQL and SSH configured, recordings will be synced and analyzed automatically every 5 minutes.
                {user?.freepbxSettings?.integration_date && (
                  <>
                    <br />
                    <strong>Integration started:</strong> {new Date(user.freepbxSettings.integration_date).toLocaleString()}
                    <br />
                    <em>Only calls after this date will be synced to avoid importing old historical data.</em>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">MySQL Database Access (CDR)</div>
              <div className="setting-hint" style={{marginBottom: '12px'}}>
                Connect to FreePBX's Call Detail Records database for richer call history.
              </div>
              <div className="settings-grid">
                <div>
                  <div className="setting-label">MySQL Host</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="pbx.example.com"
                    value={form.mysql_host}
                    onChange={(e) => handleFieldChange('mysql_host', e.target.value)}
                  />
                </div>
                <div>
                  <div className="setting-label">MySQL Port</div>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={65535}
                    value={form.mysql_port}
                    onChange={(e) => handleFieldChange('mysql_port', parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
              <div className="settings-grid">
                <div>
                  <div className="setting-label">Database Name</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="asteriskcdrdb"
                    value={form.mysql_database}
                    onChange={(e) => handleFieldChange('mysql_database', e.target.value)}
                  />
                </div>
              </div>
              <div className="settings-grid">
                <div>
                  <div className="setting-label">MySQL Username</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="mysql-user"
                    value={form.mysql_username}
                    onChange={(e) => handleFieldChange('mysql_username', e.target.value)}
                  />
                </div>
                <div>
                  <div className="setting-label">MySQL Password</div>
                  <div className="password-row">
                    <input
                      type={showMysqlPassword ? 'text' : 'password'}
                      className="text-input"
                      placeholder={form.hasMysqlPassword && !form.mysqlPasswordChanged ? '••••••••' : 'Enter MySQL password'}
                      value={form.mysql_password}
                      onChange={(e) => handleMysqlPasswordChange(e.target.value)}
                    />
                    {currentUser?.role === 'super_admin' && (
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={handleToggleShowMysqlPassword}
                        disabled={isLoadingMysqlPassword}
                        aria-label={showMysqlPassword ? 'Hide MySQL password' : 'Show MySQL password'}
                      >
                        {isLoadingMysqlPassword ? 'Loading...' : showMysqlPassword ? 'Hide' : 'Show'}
                      </button>
                    )}
                  </div>
                  {mysqlPasswordRevealError && <div className="field-error">{mysqlPasswordRevealError}</div>}
                  {form.hasMysqlPassword && !form.mysqlPasswordChanged && (
                    <button type="button" className="link-btn" onClick={handleClearMysqlPassword}>
                      Clear saved MySQL password
                    </button>
                  )}
                </div>
              </div>
              <div className="setting-hint">
                MySQL credentials for accessing the <code>asteriskcdrdb</code> database.
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">SSH Access (Recording Download & Redaction)</div>
              <div className="setting-hint" style={{ marginBottom: '12px' }}>
                Used to download recordings and upload redacted versions back to FreePBX.
              </div>
              <div className="settings-grid">
                <div>
                  <div className="setting-label">SSH Host</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="pbx.example.com"
                    value={form.ssh_host}
                    onChange={(e) => handleFieldChange('ssh_host', e.target.value)}
                  />
                </div>
                <div>
                  <div className="setting-label">SSH Port</div>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={65535}
                    value={form.ssh_port}
                    onChange={(e) => handleFieldChange('ssh_port', parseInt(e.target.value, 10))}
                  />
                </div>
                <div>
                  <div className="setting-label">SSH Username</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="root (or restricted user)"
                    value={form.ssh_username}
                    onChange={(e) => handleFieldChange('ssh_username', e.target.value)}
                  />
                </div>
              </div>

              <div className="settings-grid">
                <div>
                  <div className="setting-label">Recordings Base Path</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="/var/spool/asterisk/monitor"
                    value={form.ssh_base_path}
                    onChange={(e) => handleFieldChange('ssh_base_path', e.target.value)}
                  />
                </div>
              </div>

              <div className="settings-grid">
                <div>
                  <div className="setting-label">SSH Password</div>
                  <input
                    type="password"
                    className="text-input"
                    placeholder={form.hasSshPassword && !form.sshPasswordChanged ? '••••••••' : 'Enter SSH password'}
                    value={form.ssh_password}
                    onChange={(e) => handleSshPasswordChange(e.target.value)}
                  />
                  {form.hasSshPassword && !form.sshPasswordChanged && (
                    <button type="button" className="link-btn" onClick={handleClearSshPassword}>
                      Clear saved SSH password
                    </button>
                  )}
                </div>
                <div>
                  <div className="setting-label">SSH Private Key</div>
                  <textarea
                    className="text-input"
                    rows={4}
                    placeholder={form.hasSshPrivateKey && !form.sshPrivateKeyChanged ? '••••••••' : 'Paste private key (PEM)'}
                    value={form.ssh_private_key}
                    onChange={(e) => handleSshPrivateKeyChange(e.target.value)}
                  />
                  {form.hasSshPrivateKey && !form.sshPrivateKeyChanged && (
                    <button type="button" className="link-btn" onClick={handleClearSshPrivateKey}>
                      Clear saved SSH key
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-grid">
                <div>
                  <div className="setting-label">SSH Key Passphrase (optional)</div>
                  <input
                    type="password"
                    className="text-input"
                    placeholder={form.ssh_passphrase ? '••••••••' : 'Enter passphrase'}
                    value={form.ssh_passphrase}
                    onChange={(e) => handleSshPassphraseChange(e.target.value)}
                  />
                </div>
              </div>
              <div className="setting-hint">
                Use either password or private key. Key is preferred; root is allowed but a restricted user is safer.
              </div>

              <div className="setting-hint" style={{ marginTop: '10px', marginBottom: '12px', fontSize: '13px', lineHeight: 1.6 }}>
                <strong>Recordings folder stats:</strong>{' '}
                {isLoadingRecordingsStats
                  ? 'Loading...'
                  : recordingsStatsError
                  ? `Unavailable (${recordingsStatsError})`
                  : recordingsStats
                  ? (() => {
                      const first = formatDayDisplay(recordingsStats.firstDay)
                      const last = formatDayDisplay(recordingsStats.lastDay)
                      const days = computeInclusiveDays(recordingsStats.firstDay, recordingsStats.lastDay)
                      const daysText =
                        typeof days === 'number' && Number.isFinite(days) && days > 0 ? `. ${days} ${days === 1 ? 'day' : 'days'}` : ''
                      const range = first && last ? ` • ${first} – ${last}${daysText}` : ''
                      return `${recordingsStats.fileCount.toLocaleString()} files • ${recordingsStats.sizeMB.toLocaleString()} MB • ${recordingsStats.basePath}${range}`
                    })()
                  : 'Configure SSH credentials to view stats.'}
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">Recording Retention (Auto-Delete)</div>
              <div className="setting-hint" style={{ marginBottom: '12px' }}>
                Automatically deletes old recordings on your FreePBX server once per day via SSH. Times are interpreted in the selected user&apos;s timezone.
                <br />
                <strong>Timezone:</strong> {String((user as any)?.timezone || 'UTC')}
              </div>

              <div className="settings-grid">
                <div>
                  <div className="setting-label">Enable retention</div>
                  <label className="toggle-control">
                    <input
                      type="checkbox"
                      checked={Boolean(form.retention_enabled)}
                      onChange={(e) => handleFieldChange('retention_enabled', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                    <span className="toggle-label">
                      {form.retention_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>

                <div>
                  <div className="setting-label">Retention days</div>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={3650}
                    value={Number(form.retention_days || 30)}
                    onChange={(e) => handleFieldChange('retention_days', parseInt(e.target.value, 10) || 30)}
                    disabled={!form.retention_enabled}
                  />
                  <div className="setting-hint">Delete recordings older than this many days (default 30).</div>
                </div>

                <div>
                  <div className="setting-label">Run time (daily)</div>
                  <input
                    type="time"
                    className="text-input"
                    value={String(form.retention_run_time || '02:00')}
                    onChange={(e) => handleFieldChange('retention_run_time', e.target.value)}
                    disabled={!form.retention_enabled}
                  />
                  <div className="setting-hint">Daily time (HH:MM) in the user&apos;s timezone.</div>
                </div>
              </div>

              <div className="setting-hint" style={{ marginTop: '10px', fontSize: '13px', lineHeight: 1.6 }}>
                <strong>Schedule:</strong>{' '}
                {(() => {
                  const last = formatUtcIsoInTz((user as any)?.freepbxSettings?.retention_last_run_at)
                  const next = formatUtcIsoInTz((user as any)?.freepbxSettings?.retention_next_run_at)
                  const lastResult = (user as any)?.freepbxSettings?.retention_last_result
                  const deletedCountRaw = lastResult?.candidateFiles
                  const deletedCount =
                    deletedCountRaw === 0 || deletedCountRaw
                      ? Number.parseInt(String(deletedCountRaw), 10)
                      : null
                  const deletedSuffix =
                    typeof deletedCount === 'number' && Number.isFinite(deletedCount) && deletedCount >= 0
                      ? ` (${deletedCount.toLocaleString()} files deleted)`
                      : ''
                  if (!last && !next) return 'No runs yet.'
                  if (last && next) return `Last run: ${last}${deletedSuffix} • Next: ${next}`
                  if (last) return `Last run: ${last}${deletedSuffix}`
                  return `Next: ${next}`
                })()}
              </div>
              <div className="setting-hint" style={{ marginTop: '10px' }}>
                Tip for testing: set the run time a few minutes from now, save settings, and watch the recordings folder size drop after the scheduled run.
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>

        <div className="settings-section">
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">Sync History (Last 3)</div>
              {isCdrStatusLoading ? (
                <div className="setting-hint">Loading sync history...</div>
              ) : cdrStatusData?.lastRuns && cdrStatusData.lastRuns.length > 0 ? (
                <div className="sync-history">
                  {cdrStatusData.lastRuns.map((run: any, index: number) => (
                    <div key={index} className="sync-history-item">
                      <div className="sync-time">
                        {new Date(run.at).toLocaleString()}
                      </div>
                      <div className="sync-details">
                        {run.error ? (
                          <span className="sync-error">Error: {run.error}</span>
                        ) : (
                          <span className="sync-success">
                            {run.synced} calls • {run.reason}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="setting-hint">No syncs recorded yet</div>
              )}
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
        .setting-item:first-child {
          padding-top: 0;
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
        .setting-value {
          font-size: 15px;
          color: #37352f;
        }
        .setting-hint {
          font-size: 12px;
          color: #787774;
          line-height: 1.5;
        }
        .setting-hint.error {
          color: #c0362c;
        }
        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-top: 12px;
        }
        .text-input,
        .select-input,
        textarea {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e1e0dd;
          border-radius: 6px;
          font-size: 14px;
        }
        .text-input:focus,
        .select-input:focus,
        textarea:focus {
          outline: none;
          border-color: #a1a09c;
          box-shadow: 0 0 0 1px #d6d5d2;
        }
        textarea {
          resize: none;
        }
        .toggle-control {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          position: relative;
        }
        .toggle-control.small .toggle-label {
          font-size: 12px;
        }
        .toggle-control input {
          position: absolute;
          opacity: 0;
        }
        .toggle-slider {
          width: 42px;
          height: 24px;
          background: #dcdad7;
          border-radius: 999px;
          position: relative;
          transition: background 0.2s ease;
        }
        .toggle-slider::after {
          content: '';
          position: absolute;
          width: 18px;
          height: 18px;
          background: #ffffff;
          border-radius: 50%;
          top: 3px;
          left: 3px;
          transition: transform 0.2s ease;
        }
        .toggle-control input:checked + .toggle-slider {
          background: var(--app-accent);
        }
        .toggle-control input:checked + .toggle-slider::after {
          transform: translateX(18px);
        }
        .toggle-label {
          font-size: 13px;
          color: #37352f;
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
        .link-btn {
          margin-top: 6px;
          background: none;
          border: none;
          color: var(--app-accent);
          font-size: 12px;
          cursor: pointer;
          padding: 0;
        }
        .password-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .password-row :global(.text-input) {
          flex: 1;
          min-width: 0;
        }
        .password-toggle-btn {
          border: 1px solid #d7d5d1;
          background: #ffffff;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #37352f;
          cursor: pointer;
          white-space: nowrap;
        }
        .password-toggle-btn:hover:not(:disabled) {
          border-color: #d1d1cf;
          background: #f7f6f3;
        }
        .password-toggle-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .field-error {
          margin-top: 6px;
          font-size: 12px;
          color: #b9382c;
        }
        .settings-message {
          margin-top: 16px;
          padding: 12px 14px;
          border-radius: 6px;
          font-size: 13px;
        }
        .settings-message.success {
          background: #e6f4ea;
          color: #1e7b34;
          border: 1px solid #b4dfc2;
        }
        .settings-message.error {
          background: #fcebea;
          color: #b9382c;
          border: 1px solid #f5c6c3;
        }
        .form-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 12px;
        }
        .sync-status {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .sync-history {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sync-history-item {
          padding: 10px 12px;
          background: #f7f6f3;
          border-radius: 6px;
          border-left: 3px solid #e9e9e7;
        }
        .sync-time {
          font-size: 12px;
          font-weight: 500;
          color: #37352f;
          margin-bottom: 4px;
        }
        .sync-details {
          font-size: 11px;
          color: #787774;
        }
        .sync-success {
          color: var(--app-accent-hover);
        }
        .sync-error {
          color: #d1242f;
        }
        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-actions {
            width: 100%;
          }
          .settings-section {
            padding: 16px;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

