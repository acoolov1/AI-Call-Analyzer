'use client'

import { type TwilioSettings } from '@/hooks/use-user'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { useState, useEffect } from 'react'
import apiClient from '@/lib/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { buildApiUrl } from '@/lib/api-helpers'
import { useSelectedUser } from '@/hooks/use-selected-user'

export default function TwilioSettingsPage() {
  const { data: session, status } = useSession()
  const { selectedUserId } = useAdminUser()
  const { data: user, isLoading, error } = useSelectedUser()
  const queryClient = useQueryClient()
  
  const [twilioSettings, setTwilioSettings] = useState({
    forwardingEnabled: true,
    forwardPhoneNumber: '',
    recordingEnabled: true,
    callTimeout: 30,
    customGreeting: '',
    playRecordingBeep: true,
    maxRecordingLength: 3600,
    finishOnKey: '#',
    afterHoursMessage: '',
    recordingMode: 'record-from-answer' as 'record-from-answer' | 'record-from-ringing' | 'do-not-record',
  })
  const [isSavingTwilio, setIsSavingTwilio] = useState(false)
  const [twilioMessage, setTwilioMessage] = useState<string>('')

  useEffect(() => {
    if (user?.twilioSettings) {
      setTwilioSettings({
        forwardingEnabled: user.twilioSettings.forwardingEnabled ?? true,
        forwardPhoneNumber: user.twilioSettings.forwardPhoneNumber || '',
        recordingEnabled: user.twilioSettings.recordingEnabled ?? true,
        callTimeout: user.twilioSettings.callTimeout || 30,
        customGreeting: user.twilioSettings.customGreeting || '',
        playRecordingBeep: user.twilioSettings.playRecordingBeep ?? true,
        maxRecordingLength: user.twilioSettings.maxRecordingLength || 3600,
        finishOnKey: user.twilioSettings.finishOnKey || '#',
        afterHoursMessage: user.twilioSettings.afterHoursMessage || '',
        recordingMode: user.twilioSettings.recordingMode || 'record-from-answer',
      })
    }
  }, [user])

  if (status === 'loading' || isLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Twilio Call Settings</h1>
          <p className="page-subtitle">Loading...</p>
        </div>
      </DashboardLayout>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (error) {
    console.error('Twilio settings error:', error)
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Twilio Call Settings</h1>
          <p className="page-subtitle">Error loading user data. Please try refreshing the page.</p>
        </div>
      </DashboardLayout>
    )
  }

  const handleTwilioSettingChange = async (key: string, value: any) => {
    const newSettings = { ...twilioSettings, [key]: value }
    setTwilioSettings(newSettings)
    setIsSavingTwilio(true)
    setTwilioMessage('')

    try {
      const url = buildApiUrl('/api/v1/user/preferences', selectedUserId)
      const response = await apiClient.patch(url, {
        twilioSettings: { [key]: value },
      })

      if (response.data.success) {
        setTwilioMessage('Settings saved successfully!')
        
        if (response.data.data?.twilioSettings) {
          setTwilioSettings(response.data.data.twilioSettings)
        }
        
        queryClient.invalidateQueries({ queryKey: ['user'] })
        
        setTimeout(() => setTwilioMessage(''), 3000)
      }
    } catch (error: any) {
      console.error('Error saving Twilio settings:', error.message)
      
      const errorMsg = error.response?.data?.message || error.response?.data?.error?.message || 'Failed to save settings. Please try again.'
      setTwilioMessage(errorMsg)
      
      if (user?.twilioSettings) {
        setTwilioSettings(user.twilioSettings)
      }
      
      setTimeout(() => setTwilioMessage(''), 5000)
    } finally {
      setIsSavingTwilio(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <h1 className="page-title">Twilio Call Settings</h1>
          <p className="page-subtitle">Configure how your calls are handled</p>
        </div>

        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-card">
              {/* Call Forwarding */}
              <div className="setting-item">
                <div className="setting-label">Call Forwarding</div>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    checked={twilioSettings.forwardingEnabled}
                    onChange={(e) => handleTwilioSettingChange('forwardingEnabled', e.target.checked)}
                    disabled={isSavingTwilio}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">
                    {twilioSettings.forwardingEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
                <div className="setting-hint">Forward incoming calls to your phone</div>
              </div>

              {twilioSettings.forwardingEnabled && (
                <div className="setting-item">
                  <div className="setting-label">Forward Phone Number</div>
                  <input
                    type="tel"
                    className="text-input"
                    placeholder="+17175882255"
                    value={twilioSettings.forwardPhoneNumber}
                    onChange={(e) => setTwilioSettings({ ...twilioSettings, forwardPhoneNumber: e.target.value })}
                    onBlur={(e) => handleTwilioSettingChange('forwardPhoneNumber', e.target.value)}
                    disabled={isSavingTwilio}
                  />
                  <div className="setting-hint">Phone number to forward calls to (include country code)</div>
                </div>
              )}

              {twilioSettings.forwardingEnabled && (
                <div className="setting-item">
                  <div className="setting-label">Ring Duration</div>
                  <div className="slider-control">
                    <input
                      type="range"
                      min="5"
                      max="120"
                      step="5"
                      value={twilioSettings.callTimeout}
                      onChange={(e) => handleTwilioSettingChange('callTimeout', parseInt(e.target.value))}
                      disabled={isSavingTwilio}
                      className="slider"
                    />
                    <span className="slider-value">{twilioSettings.callTimeout} seconds</span>
                  </div>
                  <div className="setting-hint">How long to ring before going to voicemail</div>
                </div>
              )}

              {/* Recording Settings */}
              <div className="setting-item">
                <div className="setting-label">Call Recording</div>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    checked={twilioSettings.recordingEnabled}
                    onChange={(e) => handleTwilioSettingChange('recordingEnabled', e.target.checked)}
                    disabled={isSavingTwilio}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">
                    {twilioSettings.recordingEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
                <div className="setting-hint">Record incoming calls for transcription and analysis</div>
              </div>

              {twilioSettings.recordingEnabled && (
                <>
                  <div className="setting-item">
                    <div className="setting-label">Recording Mode</div>
                    <select
                      value={twilioSettings.recordingMode}
                      onChange={(e) => handleTwilioSettingChange('recordingMode', e.target.value)}
                      disabled={isSavingTwilio}
                      className="select-input"
                    >
                      <option value="record-from-answer">Record from answer</option>
                      <option value="record-from-ringing">Record from ringing</option>
                      <option value="do-not-record">Do not record</option>
                    </select>
                    <div className="setting-hint">When to start recording the call</div>
                  </div>

                  <div className="setting-item">
                    <div className="setting-label">Recording Beep</div>
                    <label className="toggle-control">
                      <input
                        type="checkbox"
                        checked={twilioSettings.playRecordingBeep}
                        onChange={(e) => handleTwilioSettingChange('playRecordingBeep', e.target.checked)}
                        disabled={isSavingTwilio}
                      />
                      <span className="toggle-slider"></span>
                      <span className="toggle-label">
                        {twilioSettings.playRecordingBeep ? 'Play beep' : 'No beep'}
                      </span>
                    </label>
                    <div className="setting-hint">Play a beep sound before recording starts</div>
                  </div>

                  <div className="setting-item">
                    <div className="setting-label">Max Recording Length</div>
                    <div className="slider-control">
                      <input
                        type="range"
                        min="60"
                        max="14400"
                        step="60"
                        value={twilioSettings.maxRecordingLength}
                        onChange={(e) => handleTwilioSettingChange('maxRecordingLength', parseInt(e.target.value))}
                        disabled={isSavingTwilio}
                        className="slider"
                      />
                      <span className="slider-value">{Math.floor(twilioSettings.maxRecordingLength / 60)} minutes</span>
                    </div>
                    <div className="setting-hint">Maximum length for call recordings (1-240 minutes)</div>
                  </div>

                  <div className="setting-item">
                    <div className="setting-label">Finish Recording Key</div>
                    <select
                      value={twilioSettings.finishOnKey}
                      onChange={(e) => handleTwilioSettingChange('finishOnKey', e.target.value)}
                      disabled={isSavingTwilio}
                      className="select-input"
                    >
                      <option value="#"># (Pound)</option>
                      <option value="*">* (Star)</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                    </select>
                    <div className="setting-hint">Key to press to stop recording</div>
                  </div>
                </>
              )}

              {/* Custom Messages */}
              <div className="setting-item">
                <div className="setting-label">Custom Greeting</div>
                <textarea
                  className="textarea-input"
                  placeholder="Thank you for calling. Your call is being recorded."
                  value={twilioSettings.customGreeting}
                  onChange={(e) => setTwilioSettings({ ...twilioSettings, customGreeting: e.target.value })}
                  onBlur={(e) => handleTwilioSettingChange('customGreeting', e.target.value)}
                  disabled={isSavingTwilio}
                  rows={2}
                />
                <div className="setting-hint">Message played when someone calls (leave empty for default)</div>
              </div>

              <div className="setting-item">
                <div className="setting-label">After Hours Message</div>
                <textarea
                  className="textarea-input"
                  placeholder="You've reached us outside of business hours. Please leave a message."
                  value={twilioSettings.afterHoursMessage}
                  onChange={(e) => setTwilioSettings({ ...twilioSettings, afterHoursMessage: e.target.value })}
                  onBlur={(e) => handleTwilioSettingChange('afterHoursMessage', e.target.value)}
                  disabled={isSavingTwilio}
                  rows={2}
                />
                <div className="setting-hint">Message for calls outside business hours (coming soon)</div>
              </div>

              {twilioMessage && (
                <div className={`settings-message ${twilioMessage.includes('Failed') ? 'error' : 'success'}`}>
                  {twilioMessage}
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
          margin-bottom: 32px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 64px;
          padding-top: 0;
        }

        .page-title {
          font-size: 17px;
          font-weight: 600;
          color: #2f2f2f;
          letter-spacing: -0.2px;
          margin-bottom: 4px;
        }

        .page-subtitle {
          color: #787774;
          font-size: 13px;
        }

        .settings-sections {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .settings-section {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 24px;
        }

        .settings-card {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .setting-item {
          padding: 20px 0;
          border-bottom: 1px solid #f1f1ef;
        }

        .setting-item:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .setting-item:first-child {
          padding-top: 0;
        }

        .setting-label {
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .setting-value {
          font-size: 15px;
          color: #37352f;
          margin-bottom: 6px;
        }

        .setting-hint {
          font-size: 12px;
          color: #787774;
          line-height: 1.5;
        }

        /* Toggle Switch */
        .toggle-control {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          position: relative;
        }

        .toggle-control input[type="checkbox"] {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
        }

        .toggle-slider {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
          background-color: #e9e9e7;
          border-radius: 24px;
          transition: background-color 0.2s ease;
        }

        .toggle-slider::before {
          content: '';
          position: absolute;
          width: 18px;
          height: 18px;
          left: 3px;
          top: 3px;
          background-color: white;
          border-radius: 50%;
          transition: transform 0.2s ease;
        }

        .toggle-control input[type="checkbox"]:checked + .toggle-slider {
          background-color: var(--app-accent);
        }

        .toggle-control input[type="checkbox"]:checked + .toggle-slider::before {
          transform: translateX(20px);
        }

        .toggle-control input[type="checkbox"]:disabled + .toggle-slider {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .toggle-label {
          font-size: 14px;
          color: #37352f;
          font-weight: 500;
        }

        /* Text Input */
        .text-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          font-size: 14px;
          color: #37352f;
          background-color: #ffffff;
          transition: border-color 0.15s ease;
        }

        .text-input:hover {
          border-color: #d1d1cf;
        }

        .text-input:focus {
          outline: none;
          border-color: var(--app-accent);
          box-shadow: 0 0 0 3px var(--app-accent-ring);
        }

        .text-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background-color: #f7f6f3;
        }

        /* Select Input */
        .select-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          font-size: 14px;
          color: #37352f;
          background-color: #ffffff;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }

        .select-input:hover {
          border-color: #d1d1cf;
        }

        .select-input:focus {
          outline: none;
          border-color: var(--app-accent);
          box-shadow: 0 0 0 3px var(--app-accent-ring);
        }

        .select-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background-color: #f7f6f3;
        }

        /* Textarea Input */
        .textarea-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          font-size: 14px;
          color: #37352f;
          background-color: #ffffff;
          font-family: inherit;
          resize: vertical;
          transition: border-color 0.15s ease;
        }

        .textarea-input:hover {
          border-color: #d1d1cf;
        }

        .textarea-input:focus {
          outline: none;
          border-color: var(--app-accent);
          box-shadow: 0 0 0 3px var(--app-accent-ring);
        }

        .textarea-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background-color: #f7f6f3;
        }

        /* Slider Control */
        .slider-control {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .slider {
          flex: 1;
          height: 6px;
          border-radius: 3px;
          background: #e9e9e7;
          outline: none;
          -webkit-appearance: none;
        }

        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--app-accent);
          cursor: pointer;
          transition: transform 0.1s ease;
        }

        .slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        .slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--app-accent);
          cursor: pointer;
          border: none;
          transition: transform 0.1s ease;
        }

        .slider::-moz-range-thumb:hover {
          transform: scale(1.2);
        }

        .slider:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .slider-value {
          font-size: 14px;
          font-weight: 500;
          color: #37352f;
          min-width: 80px;
          text-align: right;
        }

        /* Settings Message */
        .settings-message {
          padding: 12px 16px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          margin-top: 8px;
        }

        .settings-message.success {
          background-color: var(--app-accent-soft-bg);
          color: var(--app-accent-hover);
          border: 1px solid var(--app-accent-soft-border);
        }

        .settings-message.error {
          background-color: rgba(235, 87, 87, 0.12);
          color: #d1242f;
          border: 1px solid rgba(235, 87, 87, 0.3);
        }

        @media (max-width: 768px) {
          .settings-container {
            padding: 20px;
          }
          
          .settings-section {
            padding: 16px;
          }

          .page-title {
            font-size: 24px;
          }

          .slider-control {
            flex-direction: column;
            align-items: flex-start;
          }

          .slider-value {
            text-align: left;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

