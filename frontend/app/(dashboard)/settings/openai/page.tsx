'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { useUser } from '@/hooks/use-user'
import { useOpenAITestConnection } from '@/hooks/use-calls'

interface OpenAISettings {
  enabled: boolean
  whisperModel: string
  gptModel: string
  hasApiKey: boolean
}

const defaultSettings: OpenAISettings = {
  enabled: false,
  whisperModel: 'whisper-1',
  gptModel: 'gpt-4o-mini',
  hasApiKey: false,
}

const WHISPER_MODELS = ['whisper-1']
const GPT_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']

export default function OpenAISettingsPage() {
  const { data: session, status } = useSession()
  const { data: user, isLoading: isUserLoading, error: userError } = useUser()
  const queryClient = useQueryClient()
  const testConnectionMutation = useOpenAITestConnection()

  const [form, setForm] = useState({
    ...defaultSettings,
    apiKey: '',
    apiKeyChanged: false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  useEffect(() => {
    if (user?.openaiSettings) {
      setForm({
        enabled: user.openaiSettings.enabled ?? false,
        whisperModel: user.openaiSettings.whisperModel || 'whisper-1',
        gptModel: user.openaiSettings.gptModel || 'gpt-4o-mini',
        hasApiKey: user.openaiSettings.hasApiKey ?? false,
        apiKey: '',
        apiKeyChanged: false,
      })
    }
  }, [user?.openaiSettings])

  if (status === 'loading' || isUserLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">OpenAI Integration</h1>
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
          <h1 className="page-title">OpenAI Integration</h1>
          <p className="page-subtitle">Unable to load user profile. Please refresh and try again.</p>
        </div>
      </DashboardLayout>
    )
  }

  const handleFieldChange = (key: string, value: string | boolean) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'apiKey' && { apiKeyChanged: true }),
    }))
  }

  const handleTestConnection = async () => {
    if (!form.apiKey && !form.hasApiKey) {
      setMessage('Please enter an API key to test the connection')
      setMessageType('error')
      return
    }

    setMessage('')
    
    try {
      await testConnectionMutation.mutateAsync({
        apiKey: form.apiKey || undefined,
        whisperModel: form.whisperModel,
        gptModel: form.gptModel,
      })
      setMessage('Successfully connected to OpenAI API')
      setMessageType('success')
    } catch (error: any) {
      console.error('Test connection error:', error)
      
      // Extract error message from various possible formats
      let errorMessage = 'Connection test failed'
      
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message
      } else if (error.message) {
        errorMessage = error.message
      }
      
      setMessage(errorMessage)
      setMessageType('error')
    } finally {
      setTimeout(() => {
        if (messageType === 'error') {
          setMessage('')
        }
      }, 5000)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setMessage('')

    try {
      const payload: any = {
        enabled: form.enabled,
        whisper_model: form.whisperModel,
        gpt_model: form.gptModel,
      }

      // Only include API key if it was changed
      if (form.apiKeyChanged && form.apiKey) {
        payload.api_key = form.apiKey
      }

      await apiClient.patch('/api/v1/user/preferences', {
        openaiSettings: payload,
      })

      // Invalidate and refetch user data
      await queryClient.invalidateQueries({ queryKey: ['user'] })

      setMessage('Settings saved successfully')
      setMessageType('success')
      
      // Reset password changed flag
      setForm((prev) => ({ ...prev, apiKeyChanged: false, apiKey: '' }))
    } catch (error: any) {
      console.error('Error saving OpenAI settings:', error)
      setMessage(error.response?.data?.error || 'Failed to save OpenAI settings.')
      setMessageType('error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">OpenAI Integration</h1>
            <p className="page-subtitle">
              Configure your OpenAI API credentials for call transcription and analysis.
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={handleTestConnection}
              disabled={testConnectionMutation.isPending || (!form.apiKey && !form.hasApiKey)}
            >
              {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        <div className="settings-content">
          {message && (
            <div className={`settings-message ${messageType}`}>
              {message}
            </div>
          )}

          <div className="settings-section">
            <h2 className="section-title">Connection Settings</h2>

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
                When enabled, all calls will be transcribed and analyzed using your OpenAI API key.
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">OpenAI API Key</div>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => handleFieldChange('apiKey', e.target.value)}
                placeholder={form.hasApiKey ? '••••••••••••••••' : 'sk-...'}
                className="text-input"
              />
              <div className="setting-hint">
                Get your API key from{' '}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-btn"
                >
                  OpenAI Platform
                </a>
              </div>
            </div>

            <div className="settings-grid">
              <div>
                <div className="setting-label">Whisper Model</div>
                <select
                  value={form.whisperModel}
                  onChange={(e) => handleFieldChange('whisperModel', e.target.value)}
                  className="select-input"
                >
                  {WHISPER_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <div className="setting-hint">Model used for audio transcription.</div>
              </div>

              <div>
                <div className="setting-label">GPT Model</div>
                <select
                  value={form.gptModel}
                  onChange={(e) => handleFieldChange('gptModel', e.target.value)}
                  className="select-input"
                >
                  {GPT_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <div className="setting-hint">Model used for call analysis and summaries.</div>
              </div>
            </div>
          </div>

          <div className="info-card">
            <h3>💡 About OpenAI Integration</h3>
            <ul>
              <li>Your API key is securely encrypted and stored.</li>
              <li>
                <strong>Whisper</strong> is used to transcribe call recordings into text.
              </li>
              <li>
                <strong>GPT</strong> models analyze transcripts to generate summaries, action items, and
                sentiment.
              </li>
              <li>
                If disabled, the application will use the default system configuration (if available).
              </li>
              <li>
                Usage costs are billed directly to your OpenAI account based on your API usage.
              </li>
            </ul>
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
        .settings-message {
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 24px;
          border: 1px solid;
        }
        .settings-message.success {
          background: #d4edda;
          border-color: #c3e6cb;
          color: #155724;
        }
        .settings-message.error {
          background: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
        .settings-message.info {
          background: #d1ecf1;
          border-color: #bee5eb;
          color: #0c5460;
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
        .setting-hint {
          font-size: 12px;
          color: #787774;
          line-height: 1.5;
          margin-top: 8px;
        }
        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-top: 12px;
        }
        .text-input,
        .select-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e1e0dd;
          border-radius: 6px;
          font-size: 14px;
        }
        .text-input:focus,
        .select-input:focus {
          outline: none;
          border-color: #a1a09c;
          box-shadow: 0 0 0 1px #d6d5d2;
        }
        .toggle-control {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          position: relative;
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
        .link-btn {
          background: none;
          border: none;
          color: #0b6e99;
          font-size: 12px;
          cursor: pointer;
          padding: 0;
          text-decoration: none;
        }
        .info-card {
          padding: 16px;
          background-color: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #dee2e6;
        }
        .info-card h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .info-card ul {
          margin-left: 20px;
          font-size: 14px;
          color: #495057;
          line-height: 1.6;
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
        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-actions {
            width: 100%;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

