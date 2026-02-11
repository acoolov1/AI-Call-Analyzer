'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect, useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { useAllUsers, useCreateAdminUser, useUpdateUserAccess, useUpdateUserRole, useDeleteUser } from '@/hooks/use-admin'
import { useUser } from '@/hooks/use-user'
import { isSuperAdmin } from '@/lib/permissions'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { Search, Settings, Eye, Shield, User as UserIcon, Trash2 } from 'lucide-react'

export default function AdminPanelPage() {
  const { data: session, status } = useSession()
  const { data: currentUser } = useUser()
  const { data: allUsers, isLoading } = useAllUsers({ enabled: isSuperAdmin(currentUser) })
  const updateRoleMutation = useUpdateUserRole()
  const updateAccessMutation = useUpdateUserAccess()
  const createUserMutation = useCreateAdminUser()
  const deleteUserMutation = useDeleteUser()
  const { selectUser } = useAdminUser()
  const router = useRouter()
  
  const [searchQuery, setSearchQuery] = useState('')
  const [roleChangeUserId, setRoleChangeUserId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    role: 'admin' as 'admin' | 'user',
    // Defaults requested:
    // - For new admins: FreePBX enabled, App disabled
    // - For new users: App enabled, FreePBX disabled (checkboxes hidden)
    canUseApp: false,
    canUseFreepbxManager: true,
  })

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  // Redirect non-super-admins
  if (!isSuperAdmin(currentUser)) {
    redirect('/dashboard')
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div style={{ padding: '24px' }}>
          <h1>Loading users...</h1>
        </div>
      </DashboardLayout>
    )
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredUsers = allUsers?.filter((user: any) => {
    if (!normalizedQuery) return true
    const email = String(user.email || '').toLowerCase()
    const company = String(user.companyName || '').toLowerCase()
    const fullName = String(user.fullName || '').toLowerCase()
    return email.includes(normalizedQuery) || company.includes(normalizedQuery) || fullName.includes(normalizedQuery)
  }) || []

  const formatNameCompany = (fullName?: string, companyName?: string, fallbackEmail?: string) => {
    const name = (fullName || '').trim()
    const company = (companyName || '').trim()
    if (name && company) return `${name} (${company})`
    if (name) return name
    if (company) return company
    return fallbackEmail || 'User'
  }

  const handleChangeRole = async (userId: string, newRole: 'admin' | 'user') => {
    if (confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
      try {
        await updateRoleMutation.mutateAsync({ userId, role: newRole })
        alert(`Role updated successfully to ${newRole}`)
      } catch (error: any) {
        alert(`Failed to update role: ${error.response?.data?.message || error.message}`)
      }
    }
  }

  const handleCreateUser = async () => {
    try {
      await createUserMutation.mutateAsync(createForm)
      alert('User created successfully')
      setCreateForm((prev) => ({
        ...prev,
        email: '',
        password: '',
      }))
    } catch (error: any) {
      alert(`Failed to create user: ${error.response?.data?.message || error.message}`)
    }
  }

  const handleToggleAccess = async (userId: string, patch: { canUseApp?: boolean; canUseFreepbxManager?: boolean }) => {
    try {
      await updateAccessMutation.mutateAsync({ userId, ...patch })
    } catch (error: any) {
      alert(`Failed to update access: ${error.response?.data?.message || error.message}`)
    }
  }

  const handleConfigureSettings = (userId: string, email: string) => {
    selectUser(userId, email)
    router.push('/settings/openai')
  }

  const handleViewCalls = (userId: string, email: string) => {
    selectUser(userId, email)
    router.push('/call-history')
  }

  const handleDeleteUser = async (userId: string, email: string) => {
    const confirmMessage = `⚠️ WARNING: This will permanently delete the user "${email}" and all their data.\n\nThis action cannot be undone.\n\nAre you absolutely sure?`
    
    if (confirm(confirmMessage)) {
      try {
        await deleteUserMutation.mutateAsync(userId)
        alert(`User ${email} has been successfully deleted`)
      } catch (error: any) {
        alert(`Failed to delete user: ${error.response?.data?.message || error.message}`)
      }
    }
  }

  return (
    <DashboardLayout>
      <div className="app-container">
        <div className="header">
          <div className="header-content">
            <h1 className="header-title">User Management</h1>
            <p className="header-subtitle">
            Manage users, configure settings, and view activity
          </p>
        </div>

        {/* Create User */}
        <div className="create-user">
          <div className="create-user-title">Create User</div>
          <div className={`create-user-grid ${createForm.role === 'user' ? 'compact' : ''}`}>
            <input
              type="email"
              className="create-input"
              placeholder="Email"
              value={createForm.email}
              onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
              autoComplete="off"
            />
            <input
              type="password"
              className="create-input"
              placeholder="Initial password (min 8 chars)"
              value={createForm.password}
              onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
              autoComplete="new-password"
            />
            <select
              className="create-input"
              value={createForm.role}
              onChange={(e) => {
                const role = e.target.value as 'admin' | 'user'
                setCreateForm((p) => ({
                  ...p,
                  role,
                  canUseApp: role === 'user' ? true : false,
                  canUseFreepbxManager: role === 'admin' ? true : false,
                }))
              }}
            >
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
            {createForm.role === 'admin' && (
              <>
                <label className="create-check">
                  <input
                    type="checkbox"
                    checked={createForm.canUseFreepbxManager}
                    onChange={(e) => setCreateForm((p) => ({ ...p, canUseFreepbxManager: e.target.checked }))}
                  />
                  FreePBX Manager
                </label>
                <label className="create-check">
                  <input
                    type="checkbox"
                    checked={createForm.canUseApp}
                    onChange={(e) => setCreateForm((p) => ({ ...p, canUseApp: e.target.checked }))}
                  />
                  Core App
                </label>
              </>
            )}
            <button
              className="create-btn"
              type="button"
              disabled={createUserMutation.isPending || !createForm.email || createForm.password.length < 8}
              onClick={handleCreateUser}
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>

        {/* Search */}
          <div className="search-wrapper">
            <div className="search-container">
              <svg className="search-icon" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
          <input
            type="text"
                className="search-input"
            placeholder="Search users by email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
              {searchQuery && (
                <button className="clear-button visible" onClick={() => setSearchQuery('')} aria-label="Clear search">
                  <svg className="clear-icon" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th className="header-cell">
                  User
                </th>
                <th className="header-cell">
                  Role
                </th>
                <th className="header-cell">
                  Access
                </th>
                <th className="header-cell">
                  Plan
                </th>
                <th className="header-cell">
                  Calls
                </th>
                <th className="header-cell">
                  Settings
                </th>
                <th className="header-cell cell-actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="data-row">
                  <td className="table-cell">
                    <div className="user-info">
                      <div className="user-avatar">
                        {user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="user-email">
                          {formatNameCompany((user as any).fullName, (user as any).companyName, user.email)}
                        </div>
                        <div className="user-joined">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className={`role-badge ${user.role === 'admin' ? 'role-admin' : 'role-user'}`}>
                      {user.role === 'admin' && <Shield size={12} />}
                      {user.role}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="access-badges">
                      {user.role === 'admin' ? (
                        <>
                          <label className="access-check">
                            <input
                              type="checkbox"
                              checked={user.canUseFreepbxManager}
                              disabled={user.id === currentUser?.id}
                              onChange={(e) => handleToggleAccess(user.id, { canUseFreepbxManager: e.target.checked })}
                            />
                            FreePBX
                          </label>
                          <label className="access-check">
                            <input
                              type="checkbox"
                              checked={user.canUseApp}
                              disabled={user.id === currentUser?.id}
                              onChange={(e) => handleToggleAccess(user.id, { canUseApp: e.target.checked })}
                            />
                            App
                          </label>
                        </>
                      ) : user.role === 'super_admin' ? (
                        <span className="access-static">Full access</span>
                      ) : (
                        <>
                          <span className="access-static">App</span>
                          {user.canUseFreepbxManager ? <span className="access-static">FreePBX</span> : null}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="table-cell cell-content">
                    {user.subscriptionTier}
                  </td>
                  <td className="table-cell cell-content">
                    {user.callCount}
                  </td>
                  <td className="table-cell">
                    <div className="settings-badges">
                      {user.hasOpenAISettings && (
                        <span className="setting-badge setting-openai">
                          OpenAI
                        </span>
                      )}
                      {user.hasFreePBXSettings && (
                        <span className="setting-badge setting-freepbx">
                          FreePBX
                        </span>
                      )}
                      {!user.hasOpenAISettings && !user.hasFreePBXSettings && (
                        <span className="setting-none">None</span>
                      )}
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="action-buttons">
                      <button
                        onClick={() => handleViewCalls(user.id, user.email)}
                        className="action-btn"
                        title="View Calls"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      <button
                        onClick={() => handleConfigureSettings(user.id, user.email)}
                        className="action-btn"
                        title="Configure Settings"
                      >
                        <Settings size={14} />
                        Settings
                      </button>
                      {user.id !== currentUser?.id && user.role !== 'super_admin' && (
                        <>
                          <button
                            onClick={() => handleChangeRole(user.id, user.role === 'admin' ? 'user' : 'admin')}
                            className={`action-btn ${user.role === 'admin' ? 'role-change-admin' : ''}`}
                            title={user.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                          >
                            {user.role === 'admin' ? <UserIcon size={14} /> : <Shield size={14} />}
                            {user.role === 'admin' ? 'Demote' : 'Promote'}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id, user.email)}
                            disabled={deleteUserMutation.isPending}
                            className="action-btn delete-btn"
                            title="Delete User"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredUsers.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">👥</div>
              <div className="empty-state-text">
                {searchQuery ? 'No users match your search' : 'No users found'}
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .app-container {
          width: 100%;
          padding: 0;
        }
        
        .header {
          background: #ffffff;
          border-bottom: 1px solid #e9e9e7;
          padding: 18px 32px 20px;
          position: sticky;
          top: 0;
          z-index: 100;
          backdrop-filter: blur(10px);
          background: rgba(255, 255, 255, 0.95);
        }
        
        .header-content {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 64px;
          padding-top: 0;
          margin-bottom: 16px;
        }

        .create-user {
          margin-bottom: 16px;
          padding: 14px;
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          background: #ffffff;
        }

        .create-user-title {
          font-size: 12px;
          font-weight: 600;
          color: #787774;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 10px;
        }

        .create-user-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 160px auto auto 120px;
          gap: 10px;
          align-items: center;
        }
        
        .create-user-grid.compact {
          grid-template-columns: 1fr 1fr 160px 120px;
        }

        .create-input {
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 13px;
          color: #37352f;
          background: #ffffff;
          outline: none;
        }

        .create-check {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #37352f;
          white-space: nowrap;
        }

        .create-btn {
          border: 1px solid #d7d5d1;
          background: #ffffff;
          padding: 10px 14px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          color: #37352f;
          transition: all 0.15s ease;
        }

        .create-btn:hover:not(:disabled) {
          background: #f7f6f3;
          border-color: #d1d1cf;
        }

        .create-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .header-title {
          font-size: 17px;
          font-weight: 600;
          color: #2f2f2f;
          letter-spacing: -0.2px;
          margin-bottom: 4px;
        }
        
        .header-subtitle {
          color: #787774;
          font-size: 13px;
        }
        
        .search-wrapper {
          position: relative;
          max-width: 420px;
          width: 100%;
        }
        
        .search-container {
          display: flex;
          align-items: center;
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 10px 14px;
          transition: all 0.15s ease;
          position: relative;
        }
        
        .search-container:hover {
          background: #ffffff;
          border-color: #d1d1cf;
        }
        
        .search-icon {
          width: 18px;
          height: 18px;
          color: #787774;
          margin-right: 10px;
          flex-shrink: 0;
          fill: currentColor;
        }
        
        .search-input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 14px;
          color: #37352f;
          background: transparent;
          font-weight: 400;
        }
        
        .search-input::placeholder {
          color: #9b9a97;
          font-weight: 400;
        }
        
        .clear-button {
          display: none;
          width: 20px;
          height: 20px;
          border: none;
          background: none;
          cursor: pointer;
          padding: 0;
          color: #9b9a97;
          border-radius: 50%;
          transition: all 0.1s ease;
        }
        
        .clear-button:hover {
          background: rgba(55, 53, 47, 0.08);
          color: #37352f;
        }
        
        .clear-button.visible {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .clear-icon {
          width: 16px;
          height: 16px;
          fill: currentColor;
        }

        .table-wrapper {
          overflow-x: auto;
          width: 100%;
          background: #ffffff;
          margin-top: 0;
        }

        .access-badges {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .access-check {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #37352f;
          white-space: nowrap;
        }

        .access-check input[type="checkbox"] {
          width: 14px;
          height: 14px;
        }
        
        .access-static {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 6px;
          background: #f3f2ef;
          color: #37352f;
          font-size: 12px;
          font-weight: 500;
        }

        @media (max-width: 1100px) {
          .create-user-grid {
            grid-template-columns: 1fr;
          }
        }

        .table-wrapper::-webkit-scrollbar {
          height: 8px;
        }

        .table-wrapper::-webkit-scrollbar-track {
          background: #f7f6f3;
        }

        .table-wrapper::-webkit-scrollbar-thumb {
          background: #d1d1cf;
          border-radius: 4px;
        }

        .table-wrapper::-webkit-scrollbar-thumb:hover {
          background: #9b9a97;
        }
        
        .data-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          background: #ffffff;
        }

        .data-table thead tr {
          border-bottom: 1px solid #e9e9e7;
        }

        .data-table td {
          padding: 14px 16px;
          border-bottom: 1px solid #f1f1ef;
          vertical-align: middle;
          background: #ffffff;
        }
        
        .data-table tbody tr.data-row {
          transition: background 0.15s ease;
        }
        
        .data-table tbody tr.data-row:hover {
          background: #f7f6f3;
        }
        
        .data-table tbody tr.data-row:hover td {
          background: #f7f6f3;
        }
        
        .header-cell {
          padding: 10px 16px;
          font-weight: 600;
          font-size: 11px;
          color: #787774;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          white-space: nowrap;
          text-align: left;
          line-height: 1.4;
          background: #ffffff;
          border-bottom: 1px solid #e9e9e7;
        }

        .cell-actions {
          text-align: right;
        }
        
        .table-cell {
          padding: 16px 20px;
        }

        .cell-content {
          color: #37352f;
          font-size: 12px;
          line-height: 1.5;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          min-width: 36px;
          min-height: 36px;
          max-width: 36px;
          max-height: 36px;
          flex: 0 0 36px;
          border-radius: 50%;
          background: var(--app-accent);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          line-height: 1;
        }

        .user-email {
          font-size: 14px;
          font-weight: 500;
          color: #1f1f1f;
        }

        .user-joined {
          font-size: 12px;
          color: #6b6a66;
        }

        .role-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
        }

        .role-admin {
          background: #fef3c7;
          color: #92400e;
        }

        .role-user {
          background: #f3f2ef;
          color: #37352f;
        }

        .settings-badges {
          display: flex;
          gap: 6px;
        }

        .setting-badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 11px;
        }

        .setting-openai {
          background: #dcfce7;
          color: #166534;
        }

        .setting-freepbx {
          background: #dbeafe;
          color: #1e40af;
        }

        .setting-none {
          font-size: 12px;
          color: #9ca3af;
        }

        .action-buttons {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }

        .action-btn {
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid #e8e6df;
          background: #ffffff;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s ease;
        }

        .action-btn:hover {
          background: #f7f6f3;
          border-color: #d1d1cf;
        }

        .role-change-admin {
          background: #fef3c7;
        }

        .delete-btn {
          border-color: #fca5a5;
          color: #dc2626;
        }

        .delete-btn:hover {
          background: #fef2f2;
        }

        .delete-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 64px 32px;
          text-align: center;
        }
        
        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }
        
        .empty-state-text {
          font-size: 14px;
          color: #787774;
          max-width: 400px;
        }
      `}</style>
    </DashboardLayout>
  )
}

