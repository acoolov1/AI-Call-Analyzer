'use client'

import { useStats, useCalls } from '@/hooks/use-calls'
import { useUser } from '@/hooks/use-user'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { formatDateInTimezone } from '@/lib/timezone'
import Link from 'next/link'

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const { data: user } = useUser()
  const { data: stats, isLoading } = useStats()
  const { data: recentCalls } = useCalls({ limit: 5 })

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (isLoading) {
    return <div>Loading dashboard...</div>
  }

  return (
    <DashboardLayout>
      <div className="dashboard-wrapper">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Overview of your call analytics</p>
      </div>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Calls</div>
          <div className="stat-value">{stats?.totalCalls || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Positive Sentiment</div>
          <div className="stat-value">{stats?.positiveSentiment || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Negative Sentiment</div>
          <div className="stat-value">{stats?.negativeSentiment || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Urgent Topics</div>
          <div className="stat-value">{stats?.urgentTopics || 0}</div>
        </div>
      </div>

      <div className="recent-calls">
        <h2 className="section-title">Recent Calls</h2>
        {recentCalls && recentCalls.length > 0 ? (
          <div className="call-list">
            {recentCalls.map((call) => {
              const displayCaller = call.callerName 
                ? `${call.callerName} (${call.callerNumber})` 
                : call.callerNumber
              return (
                <div key={call.id} className="call-item">
                  <div className="call-item-info">
                    <div className="call-item-number">{displayCaller}</div>
                    <div className="call-item-date">
                      {formatDateInTimezone(call.createdAt, user?.timezone || 'UTC', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                  <Link href={`/calls/${call.id}`} className="call-item-link">
                    View Details
                  </Link>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="empty-state-text">No calls yet. Make a call to your Twilio number to get started.</p>
        )}
      </div>
      </div>

      <style jsx>{`
        .dashboard-wrapper {
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
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        
        .stat-card {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 20px;
        }
        
        .stat-label {
          font-size: 12px;
          color: #787774;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 8px;
        }
        
        .stat-value {
          font-size: 32px;
          font-weight: 600;
          color: #37352f;
        }
        
        .recent-calls {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 20px;
        }
        
        .section-title {
          font-size: 16px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 16px;
        }
        
        .call-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .call-item {
          padding: 12px;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .call-item-info {
          flex: 1;
        }
        
        .call-item-number {
          font-weight: 500;
          color: #37352f;
          margin-bottom: 4px;
        }
        
        .call-item-date {
          font-size: 12px;
          color: #787774;
        }
        
        .call-item-link {
          color: #37352f;
          text-decoration: none;
          font-size: 12px;
          padding: 6px 12px;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          transition: background-color 0.15s ease;
        }
        
        .call-item-link:hover {
          background: #f7f6f3;
        }
        
        .empty-state-text {
          color: #787774;
          font-size: 14px;
        }
        
        @media (max-width: 768px) {
          .dashboard-wrapper {
            padding: 20px;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}
