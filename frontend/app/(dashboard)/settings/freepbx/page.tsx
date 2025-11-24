'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { useUser } from '@/hooks/use-user'
import { useFreepbxStatus, useFreepbxSync, useFreepbxTestConnection } from '@/hooks/use-calls'
import type { FreePbxSettings } from '@/types/call'

const defaultSettings: FreePbxSettings = {
  enabled: false,
  host: '',
  port: 8089,
  username: '',
  tls: true,
  syncIntervalMinutes: 10,
  hasPassword: false,
}

export default function FreePbxSettingsPage() {
  const { data: session, status } = useSession()
  const { data: user, isLoading: isUserLoading, error: userError } = useUser()
  const queryClient = useQueryClient()

  const { data: statusData, isLoading: isStatusLoading } = useFreepbxStatus()
  const syncMutation = useFreepbxSync()
  const testConnectionMutation = useFreepbxTestConnection()

  const [form, setForm] = useState({
    ...defaultSettings,
    password: '',
    passwordChanged: false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  useEffect(() => {
    if (user?.freepbxSettings) {
      setForm({
        enabled: user.freepbxSettings.enabled ?? false,
        host: user.freepbxSettings.host || '',
        port: user.freepbxSettings.port || 8089,
        username: user.freepbxSettings.username || '',
        tls: user.freepbxSettings.tls ?? true,
        syncIntervalMinutes: user.freepbxSettings.syncIntervalMinutes || 10,
        hasPassword: user.freepbxSettings.hasPassword ?? false,
        password: '',
        passwordChanged: false,
      })
    }
  }, [user?.freepbxSettings])

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

  const handlePasswordChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      password: value,
      passwordChanged: true,
    }))
  }

  const handleClearPassword = () => {
    setForm((prev) => ({
      ...prev,
      password: '',
      passwordChanged: true,
      hasPassword: false,
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
          host: form.host,
          port: Number(form.port),
          username: form.username,
          tls: form.tls,
          syncIntervalMinutes: Number(form.syncIntervalMinutes),
        },
      }

      if (form.passwordChanged) {
        payload.freepbxSettings.password = form.password
      }

      const response = await apiClient.patch('/api/v1/user/preferences', payload)

      if (response.data.success) {
        setMessage('FreePBX settings saved successfully.')
        setMessageType('success')
        queryClient.invalidateQueries({ queryKey: ['user'] })
        queryClient.invalidateQueries({ queryKey: ['freepbx-status'] })
        setForm((prev) => ({
          ...prev,
          password: '',
          passwordChanged: false,
          hasPassword: Boolean(form.password || response.data.data?.freepbxSettings?.hasPassword),
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

  const handleTestConnection = async () => {
    setMessage('')
    try {
      await testConnectionMutation.mutateAsync()
      setMessage('Successfully connected to FreePBX.')
      setMessageType('success')
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Connection test failed.'
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
              onClick={handleTestConnection}
              disabled={testConnectionMutation.isPending || !form.enabled}
            >
              {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={handleManualSync}
              disabled={syncMutation.isPending || isStatusLoading}
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>

        <form className="settings-section" onSubmit={handleSave}>
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
                When enabled, new recordings will be pulled from your FreePBX instance.
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">Host</div>
              <input
                type="text"
                className="text-input"
                placeholder="pbx.example.com"
                value={form.host}
                onChange={(e) => handleFieldChange('host', e.target.value)}
                required={form.enabled}
              />
              <div className="settings-grid">
                <div>
                  <div className="setting-label">Port</div>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => handleFieldChange('port', parseInt(e.target.value, 10))}
                  />
                </div>
                <div>
                  <div className="setting-label">TLS</div>
                  <label className="toggle-control small">
                    <input
                      type="checkbox"
                      checked={form.tls}
                      onChange={(e) => handleFieldChange('tls', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                    <span className="toggle-label">{form.tls ? 'HTTPS' : 'HTTP'}</span>
                  </label>
                </div>
                <div>
                  <div className="setting-label">Sync Interval</div>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={120}
                    value={form.syncIntervalMinutes}
                    onChange={(e) => handleFieldChange('syncIntervalMinutes', parseInt(e.target.value, 10))}
                  />
                  <div className="setting-hint">Minutes between automatic syncs</div>
                </div>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">Credentials</div>
              <div className="settings-grid">
                <div>
                  <div className="setting-label">Username</div>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="ari-user"
                    value={form.username}
                    onChange={(e) => handleFieldChange('username', e.target.value)}
                    required={form.enabled}
                  />
                </div>
                <div>
                  <div className="setting-label">Password</div>
                  <input
                    type="password"
                    className="text-input"
                    placeholder={form.hasPassword && !form.passwordChanged ? '••••••••' : 'Enter password'}
                    value={form.password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                  />
                  {form.hasPassword && !form.passwordChanged && (
                    <button type="button" className="link-btn" onClick={handleClearPassword}>
                      Clear saved password
                    </button>
                  )}
                </div>
              </div>
              <div className="setting-hint">
                Credentials should match an ARI user defined in <code>/etc/asterisk/ari.conf</code>.
              </div>
            </div>
          </div>

          {message && (
            <div className={`settings-message ${messageType}`}>
              {message}
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>

        <div className="settings-section">
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">Sync Status</div>
              {isStatusLoading ? (
                <div className="setting-hint">Loading sync history...</div>
              ) : (
                <div className="sync-status">
                  <div>
                    <div className="setting-value">
                      Last run:{' '}
                      {statusData?.lastRun?.at
                        ? new Date(statusData.lastRun.at).toLocaleString()
                        : 'No syncs recorded yet'}
                    </div>
                    {statusData?.lastRun?.synced !== undefined && (
                      <div className="setting-hint">
                        Imported {statusData.lastRun.synced} new recordings ({statusData.lastRun.reason})
                      </div>
                    )}
                    {statusData?.lastRun?.error && (
                      <div className="setting-hint error">
                        Error: {statusData.lastRun.error}
                      </div>
                    )}
                  </div>
                </div>
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
          background: #37352f;
        }
        .toggle-control input:checked + .toggle-slider::after {
          transform: translateX(18px);
        }
        .toggle-label {
          font-size: 13px;
          color: #37352f;
        }
        .ghost-btn {
          padding: 8px 14px;
          border: 1px solid #d7d5d1;
          background: #fff;
          border-radius: 6px;
          font-size: 13px;
          color: #37352f;
          cursor: pointer;
        }
        .ghost-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .primary-btn {
          background: #1f1f1f;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 12px 20px;
          font-size: 14px;
          cursor: pointer;
        }
        .primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .link-btn {
          margin-top: 6px;
          background: none;
          border: none;
          color: #0b6e99;
          font-size: 12px;
          cursor: pointer;
          padding: 0;
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

