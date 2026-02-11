'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import DashboardLayout from '@/components/DashboardLayout'
import { useSelectedUser } from '@/hooks/use-selected-user'
import apiClient from '@/lib/api-client'
import { buildApiUrl } from '@/lib/api-helpers'
import { useAdminUser } from '@/contexts/AdminUserContext'

export default function AccountSettingsPage() {
  const { data: session, status } = useSession()
  const { selectedUserId } = useAdminUser()
  const { data: user, isLoading, error } = useSelectedUser()
  const queryClient = useQueryClient()

  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  const initialProfile = useMemo(
    () => ({
      fullName: user?.fullName || '',
      companyName: user?.companyName || '',
      phone: user?.phone || '',
      addressLine1: user?.addressLine1 || '',
      addressLine2: user?.addressLine2 || '',
      city: user?.city || '',
      state: user?.state || '',
      postalCode: user?.postalCode || '',
      country: user?.country || '',
    }),
    [user]
  )

  const [profile, setProfile] = useState(initialProfile)

  useEffect(() => {
    setProfile(initialProfile)
  }, [initialProfile])

  if (status === 'loading' || isLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Account Settings</h1>
          <p className="page-subtitle">Loading...</p>
        </div>
      </DashboardLayout>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (error) {
    console.error('Account settings error:', error)
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Account Settings</h1>
          <p className="page-subtitle">Error loading user data. Please try refreshing the page.</p>
        </div>
      </DashboardLayout>
    )
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const handleProfileChange = (key: keyof typeof profile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  const handleSaveProfile = async () => {
    setIsSaving(true)
    setMessage('')

    const requiredFields: Array<[string, string]> = [
      ['Full name', profile.fullName],
      ['Company name', profile.companyName],
      ['Phone', profile.phone],
      ['Address line 1', profile.addressLine1],
      ['City', profile.city],
      ['State', profile.state],
      ['ZIP / Postal', profile.postalCode],
      ['Country', profile.country],
    ]
    for (const [label, value] of requiredFields) {
      if (!value || value.trim().length === 0) {
        setMessage(`${label} is required`)
        setMessageType('error')
        setIsSaving(false)
        return
      }
    }

    try {
      const url = buildApiUrl('/api/v1/user/profile', selectedUserId)
      await apiClient.patch(url, {
        fullName: profile.fullName,
        companyName: profile.companyName,
        phone: profile.phone,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        city: profile.city,
        state: profile.state,
        postalCode: profile.postalCode,
        country: profile.country,
      })

      await queryClient.invalidateQueries({ queryKey: ['user'] })
      await queryClient.invalidateQueries({ queryKey: ['user', selectedUserId || 'current'] })

      setMessage('Profile saved successfully')
      setMessageType('success')
    } catch (err: any) {
      setMessage(err?.response?.data?.message || 'Failed to save profile')
      setMessageType('error')
    } finally {
      setIsSaving(false)
    }
  }

  const formatDateShort = (iso: string | null | undefined) => {
    if (!iso) return 'N/A'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return 'N/A'
    return date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <h1 className="page-title">Account Settings</h1>
          <p className="page-subtitle">Your account details and subscription information</p>
        </div>

        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-label">Email Address</div>
                <div className="setting-value">{user?.email || session?.user?.email || 'N/A'}</div>
                <div className="setting-hint">Your email address is used for authentication</div>
              </div>

              <div className="setting-item">
                <div className="setting-label">Account Created</div>
                <div className="setting-value">
                  {user?.createdAt ? formatDate(user.createdAt) : 'N/A'}
                </div>
                <div className="setting-hint">When your account was created</div>
              </div>

              <details className="setting-item setting-item-collapsible">
                <summary className="setting-label setting-label-clickable">User ID</summary>
                <div className="setting-value setting-value-code">
                  {user?.id || 'N/A'}
                </div>
                <div className="setting-hint">Your unique user identifier (for debugging)</div>
              </details>
            </div>
          </div>

          <div className="settings-section">
            <div className="section-header">
              <div>
                <h2 className="section-title">Account Profile</h2>
                <p className="section-subtitle">Company and contact information</p>
              </div>
              <button
                type="button"
                className="primary-btn"
                onClick={handleSaveProfile}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>

            {message && <div className={`settings-message ${messageType}`}>{message}</div>}

            <div className="settings-grid">
              <div>
                <div className="field-label">Full name</div>
                <input
                  className="text-input"
                  value={profile.fullName}
                  onChange={(e) => handleProfileChange('fullName', e.target.value)}
                />
              </div>
              <div>
                <div className="field-label">Company name</div>
                <input
                  className="text-input"
                  value={profile.companyName}
                  onChange={(e) => handleProfileChange('companyName', e.target.value)}
                />
              </div>
              <div>
                <div className="field-label">Phone</div>
                <input
                  className="text-input"
                  value={profile.phone}
                  onChange={(e) => handleProfileChange('phone', e.target.value)}
                />
              </div>
              <div className="grid-span-2">
                <div className="field-label">Address line 1</div>
                <input
                  className="text-input"
                  value={profile.addressLine1}
                  onChange={(e) => handleProfileChange('addressLine1', e.target.value)}
                />
              </div>
              <div className="grid-span-2">
                <div className="field-label">Address line 2 (optional)</div>
                <input
                  className="text-input"
                  value={profile.addressLine2}
                  onChange={(e) => handleProfileChange('addressLine2', e.target.value)}
                />
              </div>
              <div>
                <div className="field-label">City</div>
                <input
                  className="text-input"
                  value={profile.city}
                  onChange={(e) => handleProfileChange('city', e.target.value)}
                />
              </div>
              <div>
                <div className="field-label">State</div>
                <input
                  className="text-input"
                  value={profile.state}
                  onChange={(e) => handleProfileChange('state', e.target.value)}
                />
              </div>
              <div>
                <div className="field-label">ZIP / Postal</div>
                <input
                  className="text-input"
                  value={profile.postalCode}
                  onChange={(e) => handleProfileChange('postalCode', e.target.value)}
                />
              </div>
              <div>
                <div className="field-label">Country</div>
                <input
                  className="text-input"
                  value={profile.country}
                  onChange={(e) => handleProfileChange('country', e.target.value)}
                />
              </div>
            </div>

            <div className="compliance-row">
              <div className="compliance-item">
                <div className="field-label">Terms accepted</div>
                <div className="setting-value">{formatDateShort(user?.tosAcceptedAt)}</div>
              </div>
              <div className="compliance-item">
                <div className="field-label">Privacy accepted</div>
                <div className="setting-value">{formatDateShort(user?.privacyAcceptedAt)}</div>
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

        .section-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }

        .section-title {
          font-size: 15px;
          font-weight: 600;
          color: #2f2f2f;
          letter-spacing: -0.1px;
          margin: 0 0 4px 0;
        }

        .section-subtitle {
          color: #787774;
          font-size: 12px;
          margin: 0;
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

        .setting-item-collapsible {
          border: none;
          padding: 0;
        }

        .setting-item-collapsible summary {
          padding: 20px 0;
          border-bottom: 1px solid #f1f1ef;
          cursor: pointer;
          list-style: none;
        }

        .setting-item-collapsible summary::-webkit-details-marker {
          display: none;
        }

        .setting-item-collapsible summary::before {
          content: '▶';
          display: inline-block;
          margin-right: 8px;
          transition: transform 0.2s ease;
          color: #787774;
        }

        .setting-item-collapsible[open] summary::before {
          transform: rotate(90deg);
        }

        .setting-item-collapsible .setting-value {
          padding-top: 12px;
        }

        .setting-label {
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .setting-label-clickable {
          cursor: pointer;
          user-select: none;
        }

        .setting-value {
          font-size: 15px;
          color: #37352f;
          margin-bottom: 6px;
        }

        .setting-value-code {
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          background: #f7f6f3;
          padding: 8px 12px;
          border-radius: 4px;
          border: 1px solid #e9e9e7;
          word-break: break-all;
        }

        .setting-hint {
          font-size: 12px;
          color: #787774;
          line-height: 1.5;
        }

        .settings-message {
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 16px;
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

        .settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .grid-span-2 {
          grid-column: span 2;
        }

        .field-label {
          font-size: 12px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .text-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e1e0dd;
          border-radius: 6px;
          font-size: 14px;
          color: #37352f;
        }
        .text-input:focus {
          outline: none;
          border-color: var(--app-accent);
          box-shadow: 0 0 0 3px var(--app-accent-ring);
        }

        .primary-btn {
          background: var(--app-accent);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 10px 14px;
          font-size: 13px;
          cursor: pointer;
          min-width: 88px;
          text-align: center;
          height: 40px;
        }
        .primary-btn:hover:not(:disabled) {
          background: var(--app-accent-hover);
        }
        .primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .compliance-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-top: 18px;
          padding-top: 18px;
          border-top: 1px solid #f1f1ef;
        }

        .compliance-item {
          padding: 0;
        }

        .subscription-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .badge-free {
          background-color: rgba(55, 53, 47, 0.09);
          color: #37352f;
        }

        .badge-pro {
          background-color: var(--app-accent-soft-bg);
          color: var(--app-accent-hover);
        }

        .badge-enterprise {
          background-color: rgba(235, 87, 87, 0.12);
          color: #d1242f;
        }

        @media (max-width: 768px) {
          .settings-container {
            padding: 20px;
          }
          
          .settings-section {
            padding: 16px;
          }

          .settings-grid,
          .compliance-row {
            grid-template-columns: 1fr;
          }

          .page-title {
            font-size: 24px;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

