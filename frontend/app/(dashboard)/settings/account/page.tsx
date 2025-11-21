'use client'

import { useUser } from '@/hooks/use-user'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'

export default function AccountSettingsPage() {
  const { data: session, status } = useSession()
  const { data: user, isLoading, error } = useUser()

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

  const getSubscriptionBadgeClass = (tier: string) => {
    switch (tier) {
      case 'pro':
        return 'badge-pro'
      case 'enterprise':
        return 'badge-enterprise'
      default:
        return 'badge-free'
    }
  }

  const getSubscriptionLabel = (tier: string) => {
    switch (tier) {
      case 'pro':
        return 'Pro'
      case 'enterprise':
        return 'Enterprise'
      default:
        return 'Free'
    }
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
                <div className="setting-label">Subscription Tier</div>
                <div className="setting-value">
                  <span className={`subscription-badge ${getSubscriptionBadgeClass(user?.subscriptionTier || 'free')}`}>
                    {getSubscriptionLabel(user?.subscriptionTier || 'free')}
                  </span>
                </div>
                <div className="setting-hint">Your current subscription plan</div>
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
          background-color: rgba(46, 170, 220, 0.12);
          color: #0b6e99;
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

          .page-title {
            font-size: 24px;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

