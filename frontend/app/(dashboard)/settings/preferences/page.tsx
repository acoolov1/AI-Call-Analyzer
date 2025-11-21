'use client'

import { useUser } from '@/hooks/use-user'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { getCommonTimezones, detectUserTimezone } from '@/lib/timezone'
import { useState, useEffect } from 'react'
import apiClient from '@/lib/api-client'
import { useQueryClient } from '@tanstack/react-query'

export default function PreferencesPage() {
  const { data: session, status } = useSession()
  const { data: user, isLoading, error, mutate } = useUser()
  const queryClient = useQueryClient()
  const [selectedTimezone, setSelectedTimezone] = useState<string>('UTC')
  const [isSavingTimezone, setIsSavingTimezone] = useState(false)
  const [timezoneMessage, setTimezoneMessage] = useState<string>('')
  const [detectedTimezone, setDetectedTimezone] = useState<string>('')

  useEffect(() => {
    const detected = detectUserTimezone()
    setDetectedTimezone(detected)
  }, [])

  useEffect(() => {
    if (user?.timezone) {
      setSelectedTimezone(user.timezone)
    }
  }, [user])

  if (status === 'loading' || isLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Preferences</h1>
          <p className="page-subtitle">Loading...</p>
        </div>
      </DashboardLayout>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (error) {
    console.error('Preferences error:', error)
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Preferences</h1>
          <p className="page-subtitle">Error loading user data. Please try refreshing the page.</p>
        </div>
      </DashboardLayout>
    )
  }

  const handleTimezoneChange = async (newTimezone: string) => {
    setSelectedTimezone(newTimezone)
    setIsSavingTimezone(true)
    setTimezoneMessage('')

    try {
      console.log('Saving timezone:', newTimezone)
      const response = await apiClient.patch('/api/v1/user/preferences', {
        timezone: newTimezone,
      })

      console.log('Timezone response:', response.data)

      if (response.data.success) {
        setTimezoneMessage('Timezone saved successfully! Refreshing...')
        
        queryClient.invalidateQueries({ queryKey: ['user'] })
        mutate()
        
        setTimeout(() => {
          setTimezoneMessage('Timezone updated! Please refresh other pages to see changes.')
        }, 1000)
        
        setTimeout(() => setTimezoneMessage(''), 5000)
      }
    } catch (error: any) {
      console.error('Error saving timezone:', error)
      
      const errorMsg = error.response?.data?.message || 'Failed to save timezone. Please try again.'
      setTimezoneMessage(errorMsg)
      setTimeout(() => setTimezoneMessage(''), 5000)
    } finally {
      setIsSavingTimezone(false)
    }
  }

  const handleUseDetectedTimezone = () => {
    if (detectedTimezone) {
      handleTimezoneChange(detectedTimezone)
    }
  }

  const timezones = getCommonTimezones()

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <h1 className="page-title">Preferences</h1>
          <p className="page-subtitle">Customize your experience</p>
        </div>

        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-label">Timezone</div>
                <div className="timezone-control">
                  <select
                    value={selectedTimezone}
                    onChange={(e) => handleTimezoneChange(e.target.value)}
                    disabled={isSavingTimezone}
                    className="timezone-select"
                  >
                    {timezones.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                  {detectedTimezone && detectedTimezone !== selectedTimezone && (
                    <button
                      onClick={handleUseDetectedTimezone}
                      disabled={isSavingTimezone}
                      className="detect-timezone-btn"
                    >
                      Use detected: {detectedTimezone}
                    </button>
                  )}
                </div>
                <div className="setting-hint">
                  All timestamps will be displayed in your selected timezone
                  {timezoneMessage && (
                    <span className={`timezone-message ${timezoneMessage.includes('Failed') ? 'error' : 'success'}`}>
                      {' • '}{timezoneMessage}
                    </span>
                  )}
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-label">Email Notifications</div>
                <div className="setting-value">Coming soon</div>
                <div className="setting-hint">Configure email notification preferences</div>
              </div>

              <div className="setting-item">
                <div className="setting-label">Default Analysis Model</div>
                <div className="setting-value">Coming soon</div>
                <div className="setting-hint">Choose your preferred AI analysis model</div>
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

        .timezone-control {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .timezone-select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          font-size: 14px;
          color: #37352f;
          background-color: #ffffff;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }

        .timezone-select:hover {
          border-color: #d1d1cf;
        }

        .timezone-select:focus {
          outline: none;
          border-color: #2eaadc;
          box-shadow: 0 0 0 3px rgba(46, 170, 220, 0.1);
        }

        .timezone-select:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .detect-timezone-btn {
          padding: 6px 12px;
          background-color: #f7f6f3;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          font-size: 12px;
          color: #37352f;
          cursor: pointer;
          transition: all 0.15s ease;
          align-self: flex-start;
        }

        .detect-timezone-btn:hover {
          background-color: #e9e9e7;
        }

        .detect-timezone-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .timezone-message {
          font-weight: 500;
        }

        .timezone-message.success {
          color: #0b6e99;
        }

        .timezone-message.error {
          color: #d1242f;
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
        }
      `}</style>
    </DashboardLayout>
  )
}

