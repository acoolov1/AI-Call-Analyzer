'use client'

import Sidebar from './Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <div className="main-content">
        {children}
      </div>
      <style jsx>{`
        .dashboard-layout {
          display: flex;
          min-height: 100vh;
          background: #ffffff;
        }
        
        .main-content {
          margin-left: 280px;
          flex: 1;
          padding: 0;
          max-width: 1400px;
          width: calc(100% - 280px);
        }
        
        @media (max-width: 768px) {
          .dashboard-layout {
            flex-direction: column;
          }
          .main-content {
            margin-left: 0;
            width: 100%;
            padding: 0;
          }
        }
      `}</style>
    </div>
  )
}

