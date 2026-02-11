'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { useUser } from '@/hooks/use-user'
import { canUseFreepbxManager, isSuperAdmin } from '@/lib/permissions'
import {
  useFreepbxServers,
  useCreateFreepbxServer,
  useDeleteFreepbxServer,
  useTestFreepbxServer,
  useFreepbxUsers,
  useFreepbxExtensions,
  useCreateFreepbxUser,
  useDeleteFreepbxUser,
  useBulkCreateFreepbxUser,
  useBulkDeleteFreepbxUser,
  useUpdateFreepbxUserPassword,
  useFreepbxSystemMetrics,
  useUpdateFreepbxServer,
} from '@/hooks/use-freepbx-manager'
import { generateStrongPassword } from '@/lib/passwords'
import type { FreepbxServer, FreepbxUser, FreepbxExtension, FreepbxSystemMetrics } from '@/types/freepbx-manager'

type Status = { message: string; tone: 'success' | 'error' | 'info' }

export default function FreepbxUserManagerPage() {
  const { data: session, status } = useSession()
  const { data: currentUser } = useUser()

  const { data: servers, isLoading } = useFreepbxServers()
  const createServerMutation = useCreateFreepbxServer()
  const deleteServerMutation = useDeleteFreepbxServer()
  const testServerMutation = useTestFreepbxServer()
  const listUsersMutation = useFreepbxUsers()
  const extensionsMutation = useFreepbxExtensions()
  const metricsMutation = useFreepbxSystemMetrics()
  const createUserMutation = useCreateFreepbxUser()
  const deleteUserMutation = useDeleteFreepbxUser()
  const bulkCreateMutation = useBulkCreateFreepbxUser()
  const bulkDeleteMutation = useBulkDeleteFreepbxUser()
  const updatePasswordMutation = useUpdateFreepbxUserPassword()
  const updateServerMutation = useUpdateFreepbxServer()

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [serverStatuses, setServerStatuses] = useState<Record<string, Status | undefined>>({})
  const [serverUsers, setServerUsers] = useState<Record<string, FreepbxUser[]>>({})
  const [serverExtensions, setServerExtensions] = useState<Record<string, FreepbxExtension[]>>({})
  const [serverTrunks, setServerTrunks] = useState<Record<string, FreepbxExtension[]>>({})
  const [serverMetrics, setServerMetrics] = useState<Record<string, FreepbxSystemMetrics>>({})
  const [autoRefreshIndicator, setAutoRefreshIndicator] = useState<{visible: boolean; timestamp: number | null}>({
    visible: false,
    timestamp: null
  })
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null)
  const lastUpdateRef = useRef<string | null>(null)
  
  // Track which servers have had users loaded (persist this, not the passwords)
  const [usersLoadedFor, setUsersLoadedFor] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('freepbx-users-loaded-for')
      if (stored) {
        try {
          return new Set(JSON.parse(stored))
        } catch (e) {
          return new Set()
        }
      }
    }
    return new Set()
  })
  
  const [bulkDeleteUsername, setBulkDeleteUsername] = useState('')
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
  const [editingPassword, setEditingPassword] = useState<{ serverId: string; username: string } | null>(null)
  const [newPasswordInput, setNewPasswordInput] = useState('')

  // Edit server state
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    label: '',
    host: '',
    port: 22,
    rootUsername: '',
    rootPassword: '',
    webUrl: '',
    notes: '',
  })

  const [addForm, setAddForm] = useState({
    label: '',
    host: '',
    port: 22,
    rootUsername: 'root',
    rootPassword: '',
    webUrl: '',
    notes: '',
  })

  const [bulkForm, setBulkForm] = useState({
    username: '',
    password: generateStrongPassword(24),
    selectedIds: [] as string[],
  })

  const loadingServers = isLoading || status === 'loading'

  // Persist which servers had users loaded (not the passwords themselves)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('freepbx-users-loaded-for', JSON.stringify(Array.from(usersLoadedFor)))
    }
  }, [usersLoadedFor])

  // Load cached metrics and endpoints from server data on page load
  useEffect(() => {
    if (servers && servers.length > 0) {
      const metricsFromServers: Record<string, FreepbxSystemMetrics> = {}
      const extensionsFromServers: Record<string, FreepbxExtension[]> = {}
      const trunksFromServers: Record<string, FreepbxExtension[]> = {}
      let mostRecentUpdate: string | null = null
      
      servers.forEach((server) => {
        // Load cached metrics
        if (server.cpu) {
          metricsFromServers[server.id] = {
            cpu: server.cpu,
            memory: server.memory || 'N/A',
            disk: server.disk || 'N/A',
            asteriskUptime: server.asteriskUptime || null,
            firewallStatus: (server.firewallStatus as 'active' | 'inactive') || 'inactive',
            fail2banStatus: (server.fail2banStatus as 'active' | 'inactive') || 'inactive',
            openPorts: Array.isArray(server.openPorts) ? server.openPorts : []
          }
        }
        
        // Load cached endpoints
        if (server.endpointsData) {
          extensionsFromServers[server.id] = server.endpointsData.extensions || []
          trunksFromServers[server.id] = server.endpointsData.trunks || []
        }
        
        // Track most recent update timestamp
        if (server.metricsUpdatedAt) {
          if (!mostRecentUpdate || new Date(server.metricsUpdatedAt) > new Date(mostRecentUpdate)) {
            mostRecentUpdate = server.metricsUpdatedAt
          }
        }
      })
      
      setServerMetrics(metricsFromServers)
      setServerExtensions(extensionsFromServers)
      setServerTrunks(trunksFromServers)
      if (mostRecentUpdate) {
        setLastUpdateTime(mostRecentUpdate)
      }
    }
  }, [servers])

  // Show an indicator when react-query refetch brings in newer metrics
  useEffect(() => {
    if (!lastUpdateTime) return
    const prev = lastUpdateRef.current
    lastUpdateRef.current = lastUpdateTime

    if (prev && new Date(lastUpdateTime) > new Date(prev)) {
      setAutoRefreshIndicator({ visible: true, timestamp: Date.now() })
      setTimeout(() => {
        setAutoRefreshIndicator((p) => ({ ...p, visible: false }))
      }, 10000)
    }
  }, [lastUpdateTime])

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (!loadingServers && currentUser && !canUseFreepbxManager(currentUser)) {
    redirect('/dashboard')
  }

  const readOnly = !isSuperAdmin(currentUser)

  // For read-only admins, ensure we never retain or display PBX user lists.
  useEffect(() => {
    if (!readOnly) return
    setServerUsers({})
    setUsersLoadedFor(new Set())
    setShowPasswords({})
    setEditingPassword(null)
    setNewPasswordInput('')
  }, [readOnly])

  const setStatus = (id: string, status: Status | undefined) => {
    setServerStatuses((prev) => ({ ...prev, [id]: status }))
  }

  const handleToggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createServerMutation.mutateAsync(addForm)
      setAddForm({
        label: '',
        host: '',
        port: 22,
        rootUsername: 'root',
        rootPassword: '',
        webUrl: '',
        notes: '',
      })
    } catch (error: any) {
      const msg = error?.response?.data?.message || error.message || 'Failed to add PBX'
      alert(msg)
    }
  }

  const handleDeleteServer = async (server: FreepbxServer) => {
    if (!confirm(`Delete PBX ${server.label}?`)) return
    await deleteServerMutation.mutateAsync(server.id)
  }

  const handleRefreshUsers = async (id: string) => {
    setStatus(id, { message: 'Refreshing...', tone: 'info' })
    try {
      // Fetch version, extensions, and metrics (and users only for Super Admin)
      const [usersResult, versionResult, extensionsResult, metricsResult] = await Promise.all([
        readOnly ? Promise.resolve({ users: [] as FreepbxUser[] }) : listUsersMutation.mutateAsync(id),
        testServerMutation.mutateAsync(id),
        extensionsMutation.mutateAsync(id),
        metricsMutation.mutateAsync(id)
      ])
      
      if (!readOnly) {
        console.log('Loaded users for', id, ':', usersResult.users)
      }
      console.log('Loaded extensions for', id, ':', extensionsResult.extensions)
      console.log('Loaded metrics for', id, ':', metricsResult)
      setServerUsers((prev) => {
        const updated = { ...prev, [id]: readOnly ? [] : usersResult.users }
        console.log('Updated serverUsers:', updated)
        return updated
      })
      setServerExtensions((prev) => ({ ...prev, [id]: extensionsResult.extensions }))
      setServerTrunks((prev) => ({ ...prev, [id]: extensionsResult.trunks }))
      setServerMetrics((prev) => ({ ...prev, [id]: metricsResult }))
      if (!readOnly) {
        setUsersLoadedFor((prev) => new Set(prev).add(id))
      }
      setLastUpdateTime(new Date().toISOString()) // Update timestamp
      // Clear status after successful refresh
      setStatus(id, undefined)
    } catch (error: any) {
      const msg = error?.response?.data?.message || error.message || 'Refresh failed'
      setStatus(id, { message: msg, tone: 'error' })
    }
  }

  const handleRefreshAll = async () => {
    if (!servers || servers.length === 0) return
    
    // Refresh all servers in parallel
    await Promise.all(
      servers.map(server => handleRefreshUsers(server.id))
    )
  }

  const handleSelectAll = () => {
    if (!servers) return
    const allIds = servers.map(s => s.id)
    setBulkForm((prev) => ({ ...prev, selectedIds: allIds }))
  }

  const handleDeselectAll = () => {
    setBulkForm((prev) => ({ ...prev, selectedIds: [] }))
  }

  const handleDeleteUser = async (id: string, username: string) => {
    if (!confirm(`Delete user ${username}?`)) return
    setStatus(id, { message: 'Deleting user...', tone: 'info' })
    try {
      await deleteUserMutation.mutateAsync({ id, username })
      if (serverUsers[id]) {
        setServerUsers((prev) => ({
          ...prev,
          [id]: (prev[id] || []).filter((u) => u.username !== username),
        }))
      }
      setStatus(id, { message: 'User deleted', tone: 'success' })
    } catch (error: any) {
      const msg = error?.response?.data?.message || error.message || 'Failed to delete user'
      setStatus(id, { message: msg, tone: 'error' })
    }
  }

  const handleUpdatePassword = async (serverId: string, username: string, newPassword: string) => {
    if (newPassword.length < 12) {
      setStatus(serverId, { message: 'Password must be at least 12 characters', tone: 'error' })
      return
    }
    setStatus(serverId, { message: 'Updating password...', tone: 'info' })
    try {
      await updatePasswordMutation.mutateAsync({ serverId, username, password: newPassword })
      setServerUsers((prev) => ({
        ...prev,
        [serverId]: (prev[serverId] || []).map((u) => (u.username === username ? { ...u, password: newPassword } : u)),
      }))
      setEditingPassword(null)
      setNewPasswordInput('')
      setStatus(serverId, { message: `Password updated for ${username}`, tone: 'success' })
    } catch (error: any) {
      const msg = error?.response?.data?.message || error.message || 'Failed to update password'
      setStatus(serverId, { message: msg, tone: 'error' })
    }
  }

  const toggleShowPassword = (key: string) => {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleBulkCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (bulkForm.selectedIds.length === 0) {
      alert('Select at least one PBX')
      return
    }
    // Set all selected PBXs to "Creating user..." status
    bulkForm.selectedIds.forEach((id) => {
      setStatus(id, { message: 'Creating user...', tone: 'info' })
    })
    
    try {
      const result = await bulkCreateMutation.mutateAsync({
        pbxIds: bulkForm.selectedIds,
        username: bulkForm.username,
        password: bulkForm.password,
      })
      
      // Update each PBX with its individual result
      result.results.forEach((r: any) => {
        if (r.status === 'success') {
          setStatus(r.serverId, { message: 'User created', tone: 'success' })
        } else {
          setStatus(r.serverId, { message: r.message, tone: 'error' })
        }
      })
      
      if (result.password) {
        setBulkForm((prev) => ({ ...prev, password: result.password || '' }))
      }
    } catch (error: any) {
      // On error, mark all as error
      bulkForm.selectedIds.forEach((id) => {
        setStatus(id, { message: 'Failed to create user', tone: 'error' })
      })
    }
  }

  const handleBulkDelete = async (username: string) => {
    if (!username || username.trim() === '') {
      alert('Enter a username to delete')
      return
    }
    
    // Prevent deleting root user
    if (username.toLowerCase() === 'root') {
      alert('Cannot delete root user. The root user is protected and cannot be deleted.')
      return
    }
    
    if (bulkForm.selectedIds.length === 0) {
      alert('Select at least one PBX')
      return
    }
    if (!confirm(`Delete user "${username}" from ${bulkForm.selectedIds.length} selected PBX server(s)?`)) {
      return
    }
    
    // Set all selected PBXs to "Deleting user..." status
    bulkForm.selectedIds.forEach((id) => {
      setStatus(id, { message: 'Deleting user...', tone: 'info' })
    })
    
    try {
      const result = await bulkDeleteMutation.mutateAsync({
        pbxIds: bulkForm.selectedIds,
        username,
      })
      
      // Update each PBX with its individual result
      result.results.forEach((r: any) => {
        if (r.status === 'success') {
          setStatus(r.serverId, { message: 'User deleted', tone: 'success' })
        } else {
          setStatus(r.serverId, { message: r.message, tone: 'error' })
        }
      })
    } catch (error: any) {
      // On error, mark all as error
      bulkForm.selectedIds.forEach((id) => {
        setStatus(id, { message: 'Failed to delete user', tone: 'error' })
      })
    }
  }

  const toggleBulkSelection = (id: string) => {
    setBulkForm((prev) => {
      const selected = new Set(prev.selectedIds)
      if (selected.has(id)) {
        selected.delete(id)
      } else {
        selected.add(id)
      }
      return { ...prev, selectedIds: Array.from(selected) }
    })
  }

  const handleEditServer = (server: FreepbxServer) => {
    setEditingServer(server.id)
    setEditForm({
      label: server.label,
      host: server.host,
      port: server.port,
      rootUsername: server.rootUsername,
      rootPassword: '', // Don't pre-fill password for security
      webUrl: server.webUrl || '',
      notes: server.notes || '',
    })
    // Auto-expand the card if not already expanded
    if (!expanded[server.id]) {
      setExpanded((prev) => ({ ...prev, [server.id]: true }))
    }
  }

  const handleSaveEdit = async (id: string) => {
    try {
      setStatus(id, { message: 'Updating...', tone: 'info' })
      // Only send fields that were changed/provided
      const updates: any = {}
      if (editForm.label) updates.label = editForm.label
      if (editForm.host) updates.host = editForm.host
      if (editForm.port) updates.port = editForm.port
      if (editForm.rootUsername) updates.rootUsername = editForm.rootUsername
      if (editForm.rootPassword) updates.rootPassword = editForm.rootPassword
      if (editForm.webUrl !== undefined) updates.webUrl = editForm.webUrl
      if (editForm.notes !== undefined) updates.notes = editForm.notes
      
      await updateServerMutation.mutateAsync({ id, updates })
      setEditingServer(null)
      setStatus(id, { message: 'Updated successfully', tone: 'success' })
      setTimeout(() => setStatus(id, undefined), 3000)
    } catch (error: any) {
      const msg = error?.response?.data?.message || error.message || 'Update failed'
      setStatus(id, { message: msg, tone: 'error' })
    }
  }

  const handleCancelEdit = () => {
    setEditingServer(null)
    setEditForm({ label: '', host: '', port: 22, rootUsername: '', rootPassword: '', webUrl: '', notes: '' })
  }

  const sortedServers = useMemo(() => (servers || []).slice().sort((a, b) => a.label.localeCompare(b.label)), [servers])
  
  const getRegistrations = (endpoint: { registrations?: Array<{ ip: string; status: string }> | null; sourceIps?: string[] | null; sourceIp?: string | null }) => {
    const regs = Array.isArray(endpoint.registrations) ? endpoint.registrations : []
    if (regs.length > 0) {
      return regs
        .map((r) => ({ ip: String(r.ip || '').trim(), status: String(r.status || 'Unknown').trim() }))
        .filter((r) => r.ip)
    }
    const ips = Array.isArray(endpoint.sourceIps) ? endpoint.sourceIps : []
    const fallback = ips.length > 0 ? ips.filter(Boolean).map((ip) => ({ ip, status: 'Unknown' })) : endpoint.sourceIp ? [{ ip: endpoint.sourceIp, status: 'Unknown' }] : []
    return fallback
  }

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">FreePBX Manager</h1>
            <p className="page-subtitle">View FreePBX inventory and system metrics.</p>
          </div>
        </div>

        {!readOnly && (
          <div className="settings-section">
            <h2 className="section-title">Add PBX</h2>
            <form className="grid" onSubmit={handleAddServer}>
              <div>
                <label className="input-label">Label</label>
                <input className="text-input" required value={addForm.label} onChange={(e) => setAddForm((p) => ({ ...p, label: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Host</label>
                <input className="text-input" required value={addForm.host} onChange={(e) => setAddForm((p) => ({ ...p, host: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Port</label>
                <input type="number" className="text-input" min={1} max={65535} value={addForm.port} onChange={(e) => setAddForm((p) => ({ ...p, port: parseInt(e.target.value, 10) || 22 }))} />
              </div>
              <div>
                <label className="input-label">Root Username</label>
                <input className="text-input" value={addForm.rootUsername} onChange={(e) => setAddForm((p) => ({ ...p, rootUsername: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Root Password</label>
                <input className="text-input" type="password" required value={addForm.rootPassword} onChange={(e) => setAddForm((p) => ({ ...p, rootPassword: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Web URL (optional)</label>
                <input className="text-input" type="url" placeholder="https://pbx.example.com" value={addForm.webUrl} onChange={(e) => setAddForm((p) => ({ ...p, webUrl: e.target.value }))} />
              </div>
              <div>
                <label className="input-label">Notes (optional)</label>
                <input className="text-input" value={addForm.notes} onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="grid-actions">
                <button type="submit" className="primary-btn" disabled={createServerMutation.isPending}>
                  {createServerMutation.isPending ? 'Saving...' : 'Add PBX'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>PBX Inventory</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {lastUpdateTime && (
                <span 
                  style={{
                    fontSize: '12px',
                    color: '#787774',
                    marginRight: '8px',
                  }}
                >
                  Last update: {new Date(lastUpdateTime).toLocaleString()}
                </span>
              )}
              {autoRefreshIndicator.visible && autoRefreshIndicator.timestamp && (
                <span 
                  style={{
                    fontSize: '12px',
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    animation: 'fadeIn 0.3s ease-in',
                  }}
                >
                  <span style={{ 
                    width: '6px', 
                    height: '6px', 
                    borderRadius: '50%', 
                    backgroundColor: '#10b981',
                    display: 'inline-block'
                  }} />
                  Auto-updated {Math.floor((Date.now() - autoRefreshIndicator.timestamp) / 1000)}s ago
                </span>
              )}
              <button 
                type="button" 
                className="ghost-btn"
                onClick={bulkForm.selectedIds.length === servers?.length ? handleDeselectAll : handleSelectAll}
                disabled={!servers || servers.length === 0}
              >
                {bulkForm.selectedIds.length === servers?.length ? 'Deselect All' : 'Select All'}
              </button>
              <button 
                type="button" 
                className="primary-btn"
                onClick={handleRefreshAll}
                disabled={!servers || servers.length === 0 || listUsersMutation.isPending}
              >
                {listUsersMutation.isPending ? 'Refreshing...' : 'Refresh All'}
              </button>
            </div>
          </div>
          {loadingServers ? (
            <div className="setting-hint">Loading PBXs...</div>
          ) : sortedServers.length === 0 ? (
            <div className="setting-hint">No PBXs added yet.</div>
          ) : (
            <div className="pbx-list">
              {sortedServers.map((server) => {
                const isOpen = expanded[server.id]
                const status = serverStatuses[server.id]
                const users = serverUsers[server.id] || []
                const extensions = serverExtensions[server.id] || []
                const trunks = serverTrunks[server.id] || []
                const metrics = serverMetrics[server.id]
                console.log('Rendering server', server.label, 'users:', users, 'extensions:', extensions, 'trunks:', trunks)
                return (
                  <div key={server.id} className="pbx-card">
                    <div className="pbx-header">
                      <div>
                        <div className="pbx-title">
                          {server.label}
                          {server.webUrl && (
                            <a
                              href={server.webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                marginLeft: '12px',
                                fontSize: '0.875rem',
                                color: '#3b82f6',
                                textDecoration: 'none',
                                fontWeight: '400',
                              }}
                              onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                              onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                            >
                              {server.webUrl.replace(/^https?:\/\//, '')}
                            </a>
                          )}
                          {status && (
                            <span
                              style={{
                                marginLeft: '12px',
                                fontSize: '0.75rem',
                                fontWeight: '400',
                                color:
                                  status.tone === 'success'
                                    ? '#10b981'
                                    : status.tone === 'error'
                                    ? '#ef4444'
                                    : '#3b82f6',
                              }}
                            >
                              {status.message}
                            </span>
                          )}
                        </div>
                        <div className="pbx-subtitle">
                          {server.host}:{server.port} • SSH: {server.rootUsername}
                          {server.freepbxVersion && ` • FreePBX ${server.freepbxVersion}`}
                        </div>
                      </div>
                      <div className="pbx-actions">
                        <input
                          type="checkbox"
                          checked={bulkForm.selectedIds.includes(server.id)}
                          onChange={() => toggleBulkSelection(server.id)}
                        />
                        {!readOnly && (
                          <a
                            onClick={() => handleEditServer(server)}
                            style={{ cursor: 'pointer', fontSize: '12px', textDecoration: 'none' }}
                            onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                          >
                            Edit
                          </a>
                        )}
                        <a
                          onClick={() => handleRefreshUsers(server.id)}
                          style={{ cursor: 'pointer', fontSize: '12px', textDecoration: 'none' }}
                          onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                        >
                          Refresh
                        </a>
                        <a
                          onClick={() => handleToggle(server.id)}
                          style={{ cursor: 'pointer', fontSize: '12px', textDecoration: 'none' }}
                          onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {isOpen ? 'Collapse' : 'Expand'}
                        </a>
                      </div>
                    </div>

                    {metrics && (
                      <div className="pbx-metrics">
                        CPU: <span style={{ color: parseFloat(metrics.cpu) > 75 ? '#ef4444' : 'inherit' }}>{metrics.cpu}</span> | Memory: <span style={{ color: parseFloat(metrics.memory.match(/\((\d+)%\)/)?.[1] || '0') > 75 ? '#ef4444' : 'inherit' }}>{metrics.memory}</span> | Disk: <span style={{ color: parseFloat(metrics.disk.match(/\((\d+)%\)/)?.[1] || '0') > 75 ? '#ef4444' : 'inherit' }}>{metrics.disk}</span>
                        <br />
                        Asterisk: {metrics.asteriskUptime || 'N/A'}
                        <br />
                        Extensions: {extensions.filter(e => e.status === 'online').length}/{extensions.length} | Users: {users.length} | Firewall: <span style={{ color: metrics.firewallStatus === 'inactive' ? '#ef4444' : 'inherit' }}>{metrics.firewallStatus}</span> | Fail2ban: <span style={{ color: metrics.fail2banStatus === 'inactive' ? '#ef4444' : 'inherit' }}>{metrics.fail2banStatus}</span>
                        {Array.isArray(metrics.openPorts) && metrics.openPorts.length > 0 && (
                          <>
                            {' '}| Open Ports: <span>{metrics.openPorts.join(', ')}</span>
                          </>
                        )}
                      </div>
                    )}

                    {isOpen && (
                      <div className="pbx-body">
                        {editingServer === server.id ? (
                          // Edit form
                          <div className="subcard">
                            <div className="subcard-title">Edit Server Configuration</div>
                            <form className="grid" onSubmit={(e) => { e.preventDefault(); handleSaveEdit(server.id) }}>
                              <div>
                                <label className="input-label">Label</label>
                                <input
                                  className="text-input"
                                  required
                                  value={editForm.label}
                                  onChange={(e) => setEditForm(p => ({ ...p, label: e.target.value }))}
                                />
                              </div>
                              <div>
                                <label className="input-label">Host (IP or domain)</label>
                                <input
                                  className="text-input"
                                  required
                                  value={editForm.host}
                                  onChange={(e) => setEditForm(p => ({ ...p, host: e.target.value }))}
                                />
                              </div>
                              <div>
                                <label className="input-label">SSH Port</label>
                                <input
                                  type="number"
                                  className="text-input"
                                  required
                                  value={editForm.port}
                                  onChange={(e) => setEditForm(p => ({ ...p, port: parseInt(e.target.value) }))}
                                />
                              </div>
                              <div>
                                <label className="input-label">Root Username</label>
                                <input
                                  className="text-input"
                                  required
                                  value={editForm.rootUsername}
                                  onChange={(e) => setEditForm(p => ({ ...p, rootUsername: e.target.value }))}
                                />
                              </div>
                              <div>
                                <label className="input-label">Root Password (leave blank to keep current)</label>
                                <input
                                  type="password"
                                  className="text-input"
                                  value={editForm.rootPassword}
                                  onChange={(e) => setEditForm(p => ({ ...p, rootPassword: e.target.value }))}
                                  placeholder="Enter new password or leave blank"
                                />
                              </div>
                              <div>
                                <label className="input-label">Web URL (optional)</label>
                                <input
                                  type="url"
                                  className="text-input"
                                  value={editForm.webUrl}
                                  onChange={(e) => setEditForm(p => ({ ...p, webUrl: e.target.value }))}
                                  placeholder="https://pbx.example.com"
                                />
                              </div>
                              <div>
                                <label className="input-label">Notes</label>
                                <textarea
                                  className="text-input"
                                  value={editForm.notes}
                                  onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))}
                                  rows={3}
                                />
                              </div>
                              <div className="grid-actions" style={{ justifyContent: 'space-between' }}>
                                <button type="button" className="ghost-btn danger" onClick={() => handleDeleteServer(server)}>
                                  Delete PBX
                                </button>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button type="button" className="ghost-btn" onClick={handleCancelEdit}>
                                    Cancel
                                  </button>
                                  <button type="submit" className="primary-btn" disabled={updateServerMutation.isPending}>
                                    {updateServerMutation.isPending ? 'Saving...' : 'Save Changes'}
                                  </button>
                                </div>
                              </div>
                            </form>
                          </div>
                        ) : (
                          // Normal view with endpoints, info, users sections
                          <>
                            <div className="subcard">
                              <div className="subcard-title">Endpoints</div>
                              {trunks.length === 0 && extensions.length === 0 ? (
                                <div className="setting-hint">No endpoints found. Click Refresh.</div>
                              ) : (
                                <div className="extension-list">
                                  {/* Show trunks first */}
                                  {trunks.map((trunk) => (
                                    <div key={trunk.number} className="extension-row">
                                      <span className="ext-number">{trunk.number}</span>
                                      <span className="ext-name">{trunk.name || 'Trunk'}</span>
                                      <span className="ext-ip">
                                        {getRegistrations(trunk).length > 0 ? (
                                          getRegistrations(trunk).map(({ ip, status }) => {
                                            const isAvail = trunk.status === 'online' && status === 'Avail'
                                            return (
                                              <span key={`${ip}-${status}`} className={`ext-ip-line ${isAvail ? 'avail' : 'unavail'}`}>
                                                {ip}
                                              </span>
                                            )
                                          })
                                        ) : (
                                          <span className="ext-ip-line unavail">—</span>
                                        )}
                                      </span>
                                      <span className={`ext-status ${trunk.status}`}>
                                        {trunk.status === 'online' ? '● Online' : '○ Offline'}
                                      </span>
                                    </div>
                                  ))}
                                  {/* Then show extensions */}
                                  {extensions.map((ext) => (
                                    <div key={ext.number} className="extension-row">
                                      <span className="ext-number">{ext.number}</span>
                                      <span className="ext-name">{ext.name || 'No name'}</span>
                                      <span className="ext-ip">
                                        {getRegistrations(ext).length > 0 ? (
                                          getRegistrations(ext).map(({ ip, status }) => {
                                            const isAvail = ext.status === 'online' && status === 'Avail'
                                            return (
                                              <span key={`${ip}-${status}`} className={`ext-ip-line ${isAvail ? 'avail' : 'unavail'}`}>
                                                {ip}
                                              </span>
                                            )
                                          })
                                        ) : (
                                          <span className="ext-ip-line unavail">—</span>
                                        )}
                                      </span>
                                      <span className={`ext-status ${ext.status}`}>
                                        {ext.status === 'online' ? '● Online' : '○ Offline'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="subcard">
                              <div className="subcard-title">Info</div>
                              <div className="setting-hint">Additional information will appear here.</div>
                            </div>

                            <div className="subcard">
                              <div className="subcard-title">Users</div>
                              {readOnly ? (
                                <div />
                              ) : users.length === 0 ? (
                                <div className="setting-hint">No users loaded. Click Refresh.</div>
                              ) : (
                                <div className="user-list">
                                  {users.map((user) => {
                                    const key = `${server.id}-${user.username}`
                                    const isEditing = editingPassword?.serverId === server.id && editingPassword?.username === user.username
                                    return (
                                      <div key={user.username} className="user-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <span style={{ fontWeight: '500' }}>
                                            {user.username}
                                            {user.isRoot && <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#6b7280' }}>(root)</span>}
                                          </span>
                                          {!readOnly && !user.isRoot && (
                                            <button type="button" className="ghost-btn danger" onClick={() => handleDeleteUser(server.id, user.username)}>
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                        {user.password && (
                                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px' }}>
                                            {/*
                                              Ensure password is always a string for input and copy operations
                                            */}
                                            {(() => {
                                              const safePassword = user.password || ''
                                              return (
                                                <>
                                                  <input
                                                    type={showPasswords[key] ? 'text' : 'password'}
                                                    readOnly
                                                    value={showPasswords[key] ? safePassword : '•'.repeat(20)}
                                                    onFocus={(e) => e.target.select()}
                                                    style={{
                                                      flexShrink: 0,
                                                      width: '240px',
                                                      maxWidth: '240px',
                                                      overflow: 'hidden',
                                                      whiteSpace: 'nowrap',
                                                      textOverflow: 'clip',
                                                      padding: '4px 8px',
                                                      background: '#f5f5f5',
                                                      borderRadius: '4px',
                                                      fontFamily: 'monospace',
                                                      boxSizing: 'border-box',
                                                      border: '1px solid #e5e7eb',
                                                      cursor: 'text',
                                                    }}
                                                  />
                                                  <button type="button" className="ghost-btn" style={{ flexShrink: 0 }} onClick={() => toggleShowPassword(key)}>
                                                    {showPasswords[key] ? 'Hide' : 'Show'}
                                                  </button>
                                                </>
                                              )
                                            })()}
                                            {!readOnly && !user.isRoot && (
                                              <button
                                                type="button"
                                                className="ghost-btn"
                                                style={{ flexShrink: 0 }}
                                                onClick={() => {
                                                  setEditingPassword({ serverId: server.id, username: user.username })
                                                  setNewPasswordInput(user.password || '')
                                                }}
                                              >
                                                Edit
                                              </button>
                                            )}
                                          </div>
                                        )}
                                        {!readOnly && isEditing && !user.isRoot && (
                                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <input 
                                              type="text" 
                                              className="text-input" 
                                              value={newPasswordInput}
                                              onChange={(e) => setNewPasswordInput(e.target.value)}
                                              placeholder="New password (min 12 chars)"
                                              style={{ flex: 1 }}
                                            />
                                            <button type="button" className="primary-btn" onClick={() => handleUpdatePassword(server.id, user.username, newPasswordInput)}>
                                              Save
                                            </button>
                                            <button type="button" className="ghost-btn" onClick={() => { setEditingPassword(null); setNewPasswordInput('') }}>
                                              Cancel
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="settings-section">
            <h2 className="section-title">Bulk Create Users</h2>
            <form className="grid" onSubmit={handleBulkCreate}>
              <div>
                <label className="input-label">Username</label>
                <input
                  className="text-input"
                  required
                  value={bulkForm.username}
                  onChange={(e) => setBulkForm((p) => ({ ...p, username: e.target.value }))}
                />
              </div>
              <div>
                <label className="input-label">Password (auto-generated)</label>
                <input
                  className="text-input"
                  value={bulkForm.password}
                  onChange={(e) => setBulkForm((p) => ({ ...p, password: e.target.value }))}
                />
              </div>
              <div className="grid-actions">
                <button type="button" className="ghost-btn" onClick={() => setBulkForm((p) => ({ ...p, password: generateStrongPassword(24) }))}>
                  Regenerate password
                </button>
                <button type="submit" className="primary-btn" disabled={bulkCreateMutation.isPending}>
                  {bulkCreateMutation.isPending ? 'Running...' : 'Create across selected PBXs'}
                </button>
              </div>
            </form>
            <div className="setting-hint">
              Select PBX servers above and enter a username to create the user across all selected instances. Status will appear next to each PBX.
            </div>
          </div>
        )}

        {!readOnly && (
          <div className="settings-section">
            <h2 className="section-title">Bulk Delete Users</h2>
            <div className="grid">
              <div>
                <label className="input-label">Username to Delete</label>
                <input
                  className="text-input"
                  placeholder="Enter username"
                  value={bulkDeleteUsername}
                  onChange={(e) => setBulkDeleteUsername(e.target.value)}
                />
              </div>
              <div className="grid-actions">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={bulkDeleteMutation.isPending}
                  onClick={() => handleBulkDelete(bulkDeleteUsername)}
                >
                  {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete from selected PBXs'}
                </button>
              </div>
            </div>
            <div className="setting-hint">
              This will delete the user from all selected PBX servers. Selected: {bulkForm.selectedIds.length} PBX(s). Status will appear next to each PBX.
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .settings-container {
          width: 100%;
          padding: 18px 32px 32px;
        }
        .page-header {
          margin-bottom: 18px;
        }
        .page-title {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
        }
        .page-subtitle {
          color: #555;
          font-size: 13px;
          margin-top: 4px;
        }
        .settings-section {
          background: #fff;
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          padding: 18px;
          margin-bottom: 20px;
        }
        .section-title {
          font-size: 15px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
          align-items: end;
        }
        .grid-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .input-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #555;
          margin-bottom: 6px;
          display: block;
        }
        .text-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
        }
        .primary-btn {
          background: var(--app-accent);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 10px 14px;
          cursor: pointer;
        }
        .primary-btn:hover:not(:disabled) {
          background: var(--app-accent-hover);
        }
        .primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .ghost-btn {
          border: 1px solid #d7d5d1;
          background: #fff;
          border-radius: 6px;
          padding: 8px 12px;
          cursor: pointer;
        }


        .ghost-btn.danger {
          border-color: #f1c4c4;
          color: #b43030;
        }
        .primary-btn.danger {
          background: #d32f2f;
          color: #fff;
        }
        .primary-btn.danger:hover {
          background: #b71c1c;
        }
        .setting-hint {
          font-size: 12px;
          color: #777;
          margin-top: 6px;
        }
        .pbx-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .pbx-card {
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          padding: 12px;
          background: #fafafa;
        }
        .pbx-header {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: flex-start;
        }
        .pbx-title {
          font-weight: 600;
        }
        .pbx-subtitle {
          color: #666;
          font-size: 12px;
        }
        .pbx-metrics {
          font-size: 0.75rem;
          color: #666;
          padding: 8px 0;
          line-height: 1.6;
        }
        .pbx-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .checkbox {
          display: inline-flex;
          gap: 6px;
          align-items: center;
          font-size: 12px;
        }
        .status-chip {
          margin-top: 8px;
          display: inline-block;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
        }
        .status-chip.success {
          background: #e6f4ea;
          color: #1e7b34;
          border: 1px solid #b4dfc2;
        }
        .status-chip.error {
          background: #fcebea;
          color: #b9382c;
          border: 1px solid #f5c6c3;
        }
        .status-chip.info {
          background: #eef2ff;
          color: #303f9f;
          border: 1px solid #cbd3ff;
        }
        .pbx-body {
          margin-top: 10px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 12px;
        }
        .subcard {
          background: #fff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 12px;
        }
        .subcard-title {
          font-weight: 600;
          margin-bottom: 10px;
        }
        .subcard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 8px;
          align-items: center;
        }
        .user-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .user-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1px solid #f1f1ef;
          border-radius: 6px;
          padding: 8px 10px;
        }
        .extension-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .extension-row {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 4px 6px;
          background: #f9f9f9;
          border-radius: 3px;
          font-size: 13px;
        }
        .ext-number {
          font-weight: 600;
          min-width: 50px;
        }
        .ext-name {
          flex: 1;
          color: #555;
        }
        .ext-ip {
          flex-shrink: 0;
          min-width: 110px;
          text-align: right;
          font-size: 10px;
          line-height: 1.1;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }
        .ext-ip-line {
          display: block;
        }
        .ext-ip-line.avail {
          color: #10b981;
        }
        .ext-ip-line.unavail {
          color: #6b7280;
        }
        .ext-status {
          font-size: 12px;
        }
        .ext-status.online {
          color: #10b981;
        }
        .ext-status.offline {
          color: #6b7280;
        }
        .bulk-results {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        @media (max-width: 768px) {
          .pbx-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .pbx-actions {
            width: 100%;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}


