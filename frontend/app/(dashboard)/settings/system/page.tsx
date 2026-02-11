'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { useSystemMetrics, useSystemMetricsHistory } from '@/hooks/use-system'
import { useUser } from '@/hooks/use-user'
import { isSuperAdmin } from '@/lib/permissions'
import { Activity, Cpu, HardDrive, Server, Wifi, Clock } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type DatePreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'allTime' | 'custom'

const startOfDayISO = (date: Date): string => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy.toISOString()
}

const endOfDayISO = (date: Date): string => {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy.toISOString()
}

const getPresetRange = (preset: DatePreset) => {
  const today = new Date()
  const end = endOfDayISO(today)

  switch (preset) {
    case 'today': {
      return { start: startOfDayISO(today), end, label: 'Today' }
    }
    case 'last7': {
      const start = new Date()
      start.setDate(start.getDate() - 6)
      return { start: startOfDayISO(start), end, label: 'Last 7 days' }
    }
    case 'thisMonth': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return { start: startOfDayISO(start), end: endOfDayISO(endDate), label: 'This month' }
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const endDate = new Date(today.getFullYear(), today.getMonth(), 0)
      return { start: startOfDayISO(start), end: endOfDayISO(endDate), label: 'Last month' }
    }
    case 'allTime': {
      return { start: null, end: null, label: 'All time' }
    }
    default:
      return { start: startOfDayISO(today), end, label: 'Custom range' }
  }
}

export default function SystemMonitorPage() {
  const { data: session, status } = useSession()
  const { data: currentUser } = useUser()
  const { data: metrics, isLoading, error } = useSystemMetrics()

  const [datePreset, setDatePreset] = useState<DatePreset>('today')
  const [dateRange, setDateRange] = useState(() => getPresetRange('today'))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const datePickerRef = useRef<HTMLDivElement | null>(null)

  const historyQuery = useSystemMetricsHistory({
    startDate: dateRange.start,
    endDate: dateRange.end,
  })

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setIsDatePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (status === 'loading' || isLoading) {
    return (
      <DashboardLayout>
        <div className="settings-container">
          <div className="page-header">
            <h1 className="page-title">System Monitor</h1>
            <p className="page-subtitle">Loading system metrics...</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  // Redirect non-admins
  if (!isSuperAdmin(currentUser)) {
    redirect('/dashboard')
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="settings-container">
          <div className="page-header">
            <h1 className="page-title">System Monitor</h1>
            <p className="page-subtitle error-text">Failed to load system metrics. Please try again.</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(2)} GB`
  }

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'status-healthy'
      case 'warning':
        return 'status-warning'
      case 'critical':
        return 'status-critical'
      case 'error':
        return 'status-error'
      default:
        return 'status-unknown'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'Healthy'
      case 'warning':
        return 'Warning'
      case 'critical':
        return 'Critical'
      case 'error':
        return 'Error'
      default:
        return 'Unknown'
    }
  }

  const presetOptions: Array<{ key: DatePreset; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'last7', label: 'Last 7 days' },
    { key: 'thisMonth', label: 'This month' },
    { key: 'lastMonth', label: 'Last month' },
    { key: 'allTime', label: 'All time' },
    { key: 'custom', label: 'Custom range' },
  ]

  const formatRangeLabel = () => {
    if (!dateRange.start && !dateRange.end) return 'All time'
    if (datePreset !== 'custom' && dateRange.label) return dateRange.label

    const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const startLabel = dateRange.start ? formatter.format(new Date(dateRange.start)) : '...'
    const endLabel = dateRange.end ? formatter.format(new Date(dateRange.end)) : '...'
    return `${startLabel} – ${endLabel}`
  }

  const handlePresetSelect = (preset: DatePreset) => {
    setDateError(null)
    setDatePreset(preset)
    if (preset === 'custom') return
    setDateRange(getPresetRange(preset))
    setIsDatePickerOpen(false)
  }

  const handleApplyCustomRange = () => {
    if (!customStart || !customEnd) {
      setDateError('Select both start and end dates')
      return
    }
    const startDate = new Date(`${customStart}T00:00:00`)
    const endDate = new Date(`${customEnd}T23:59:59.999`)
    if (startDate > endDate) {
      setDateError('Start date must be before end date')
      return
    }
    setDateRange({
      start: startOfDayISO(startDate),
      end: endOfDayISO(endDate),
      label: 'Custom range',
    })
    setDatePreset('custom')
    setDateError(null)
    setIsDatePickerOpen(false)
  }

  const historyPoints = historyQuery.data?.points || []
  const chartData = historyPoints
    .filter((p) => p.hour)
    .map((p) => ({
      hour: p.hour as string,
      cpu: p.cpu,
      memory: p.memory,
      disk: p.disk,
    }))

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <h1 className="page-title">System Monitor</h1>
          <p className="page-subtitle">
            Real-time server resource monitoring and health status
          </p>
        </div>

        <div className="metrics-grid">
          {/* History chart */}
          <div className="metric-card history-card">
            <div className="card-header history-header">
              <Activity size={20} />
              <h2 className="card-title">Hourly averages from samples captured every 10 minutes</h2>

              <div className="history-controls">
                <div className="date-filter" ref={datePickerRef}>
                  <button
                    type="button"
                    className={`date-filter-btn ${isDatePickerOpen ? 'open' : ''}`}
                    onClick={() => setIsDatePickerOpen((prev) => !prev)}
                  >
                    <div className="date-filter-text">
                      <span className="date-filter-label sr-only">Date range</span>
                      <span className="date-filter-value">{formatRangeLabel()}</span>
                    </div>
                    <svg
                      className="date-filter-icon"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ transform: isDatePickerOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </button>

                  {isDatePickerOpen && (
                    <div className="date-filter-popover">
                      <div className="preset-grid">
                        {presetOptions.map((preset) => (
                          <button
                            key={preset.key}
                            type="button"
                            className={`preset-btn ${datePreset === preset.key ? 'active' : ''}`}
                            onClick={() => handlePresetSelect(preset.key)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      <div className="custom-range">
                        <div className="custom-inputs">
                          <label className="custom-label">
                            Start
                            <input
                              type="date"
                              value={customStart}
                              onChange={(e) => {
                                setCustomStart(e.target.value)
                                setDatePreset('custom')
                                setDateError(null)
                              }}
                            />
                          </label>
                          <label className="custom-label">
                            End
                            <input
                              type="date"
                              value={customEnd}
                              onChange={(e) => {
                                setCustomEnd(e.target.value)
                                setDatePreset('custom')
                                setDateError(null)
                              }}
                            />
                          </label>
                        </div>
                        {dateError && <div className="date-error">{dateError}</div>}
                        <div className="custom-actions">
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              setCustomStart('')
                              setCustomEnd('')
                              handlePresetSelect('allTime')
                            }}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className="btn-apply"
                            onClick={handleApplyCustomRange}
                            disabled={!customStart || !customEnd || !!dateError}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card-content">
              {historyQuery.isLoading ? (
                <div className="history-loading">Loading history…</div>
              ) : historyQuery.isError ? (
                <div className="history-error">Unable to load history for this range.</div>
              ) : chartData.length === 0 ? (
                <div className="history-empty">
                  No history samples yet for this range. (We record a sample every 10 minutes.)
                </div>
              ) : (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={(v) =>
                          new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric' }).format(
                            new Date(v)
                          )
                        }
                        minTickGap={18}
                      />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        formatter={(value: any, name: any) => [`${Number(value).toFixed(1)}%`, String(name)]}
                        labelFormatter={(label: any) =>
                          new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          }).format(new Date(label))
                        }
                      />
                      <Line type="monotone" dataKey="cpu" name="CPU" stroke="#6D5BD0" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="memory" name="Memory" stroke="#10B981" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="disk" name="Disk" stroke="#F59E0B" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Server Overview */}
          <div className="metric-card">
            <div className="card-header">
              <Activity size={20} />
              <h2 className="card-title">Server Overview</h2>
            </div>
            <div className="card-content">
              <div className="metric-item">
                <div className="metric-label">
                  <Cpu size={16} />
                  <span>CPU Usage</span>
                </div>
                <div className="metric-bar-wrapper">
                  <div className="metric-bar-container">
                    <div 
                      className={`metric-bar ${getStatusClass(metrics?.cpu.status || 'unknown')}`}
                      style={{ width: `${metrics?.cpu.usage || 0}%` }}
                    />
                  </div>
                  <span className="metric-value">{metrics?.cpu.usage.toFixed(1)}%</span>
                </div>
                <div className="metric-hint">
                  {metrics?.cpu.cores} cores • Load: {metrics?.cpu.loadAverage.map(l => l.toFixed(2)).join(', ')}
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-label">
                  <Server size={16} />
                  <span>Memory Usage</span>
                </div>
                <div className="metric-bar-wrapper">
                  <div className="metric-bar-container">
                    <div 
                      className={`metric-bar ${getStatusClass(metrics?.memory.status || 'unknown')}`}
                      style={{ width: `${metrics?.memory.percentUsed || 0}%` }}
                    />
                  </div>
                  <span className="metric-value">{metrics?.memory.percentUsed.toFixed(1)}%</span>
                </div>
                <div className="metric-hint">
                  {formatBytes(metrics?.memory.used || 0)} / {formatBytes(metrics?.memory.total || 0)} used
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-label">
                  <Clock size={16} />
                  <span>System Uptime</span>
                </div>
                <div className="metric-value-large">{metrics?.uptime.formatted}</div>
                <div className="metric-hint">{metrics?.uptime.seconds.toLocaleString()} seconds</div>
              </div>
            </div>
          </div>

          {/* Disk Space */}
          <div className="metric-card">
            <div className="card-header">
              <HardDrive size={20} />
              <h2 className="card-title">Disk Space</h2>
            </div>
            <div className="card-content">
              <div className="metric-item">
                <div className="metric-bar-wrapper">
                  <div className="metric-bar-container">
                    <div 
                      className={`metric-bar ${getStatusClass(metrics?.disk.status || 'unknown')}`}
                      style={{ width: `${metrics?.disk.percentUsed || 0}%` }}
                    />
                  </div>
                  <span className="metric-value">{metrics?.disk.percentUsed}%</span>
                </div>
              </div>
              <div className="disk-info">
                <div className="disk-stat">
                  <span className="disk-stat-label">Total</span>
                  <span className="disk-stat-value">{metrics?.disk.total}</span>
                </div>
                <div className="disk-stat">
                  <span className="disk-stat-label">Used</span>
                  <span className="disk-stat-value">{metrics?.disk.used}</span>
                </div>
                <div className="disk-stat">
                  <span className="disk-stat-label">Available</span>
                  <span className="disk-stat-value">{metrics?.disk.available}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Services Status */}
          <div className="metric-card">
            <div className="card-header">
              <Server size={20} />
              <h2 className="card-title">Services Status</h2>
            </div>
            <div className="card-content">
              <div className="service-list">
                <div className="service-item">
                  <span className="service-name">Backend API</span>
                  <span className={`service-badge ${getStatusClass(metrics?.services.backend.status || 'unknown')}`}>
                    {getStatusLabel(metrics?.services.backend.status || 'unknown')}
                  </span>
                  <span className="service-message">{metrics?.services.backend.message}</span>
                  {metrics?.services.backend.uptime && (
                    <span className="service-hint">Uptime: {Math.floor(metrics.services.backend.uptime / 60)}m</span>
                  )}
                </div>

                <div className="service-item">
                  <span className="service-name">Frontend</span>
                  <span className={`service-badge ${getStatusClass(metrics?.services.frontend.status || 'unknown')}`}>
                    {getStatusLabel(metrics?.services.frontend.status || 'unknown')}
                  </span>
                  <span className="service-message">{metrics?.services.frontend.message}</span>
                </div>

                <div className="service-item">
                  <span className="service-name">Database</span>
                  <span className={`service-badge ${getStatusClass(metrics?.services.database.status || 'unknown')}`}>
                    {getStatusLabel(metrics?.services.database.status || 'unknown')}
                  </span>
                  <span className="service-message">{metrics?.services.database.message}</span>
                  {metrics?.services.database.connections !== undefined && (
                    <span className="service-hint">{metrics.services.database.connections} connections</span>
                  )}
                </div>

                <div className="service-item">
                  <span className="service-name">Redis</span>
                  <span className={`service-badge ${getStatusClass(metrics?.services.redis.status || 'unknown')}`}>
                    {getStatusLabel(metrics?.services.redis.status || 'unknown')}
                  </span>
                  <span className="service-message">{metrics?.services.redis.message}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Network Info */}
          <div className="metric-card">
            <div className="card-header">
              <Wifi size={20} />
              <h2 className="card-title">Network</h2>
            </div>
            <div className="card-content">
              <div className="metric-item">
                <div className="metric-label">Active Interfaces</div>
                <div className="network-interfaces">
                  {metrics?.network.interfaces.map((iface, i) => (
                    <span key={i} className="interface-badge">{iface}</span>
                  ))}
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Active Connections</div>
                <div className="metric-value-large">{metrics?.network.connections.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Top Processes */}
          <div className="metric-card process-card">
            <div className="card-header">
              <Activity size={20} />
              <h2 className="card-title">Top Processes by Memory</h2>
            </div>
            <div className="card-content">
              <div className="process-table-wrapper">
                <table className="process-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>PID</th>
                      <th>CPU%</th>
                      <th>MEM%</th>
                      <th>Command</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics?.processes.map((proc, i) => (
                      <tr key={i}>
                        <td>{proc.user}</td>
                        <td className="process-pid">{proc.pid}</td>
                        <td className="process-metric">{proc.cpu.toFixed(1)}%</td>
                        <td className="process-metric">{proc.mem.toFixed(1)}%</td>
                        <td className="process-command">{proc.command}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

        .error-text {
          color: #dc2626;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 20px;
        }

        .metric-card {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          overflow: hidden;
        }

        .process-card {
          grid-column: 1 / -1;
        }

        .history-card {
          grid-column: 1 / -1;
        }

        .history-header {
          justify-content: space-between;
        }

        .history-controls {
          margin-left: auto;
        }

        .chart-wrap {
          width: 100%;
          height: 260px;
        }

        .history-loading,
        .history-error,
        .history-empty {
          font-size: 13px;
          color: #787774;
          padding: 10px 0 2px;
        }

        /* Date picker (match OpenAI Usage styles) */
        .date-filter {
          position: relative;
          min-width: 320px;
          max-width: 320px;
          width: 100%;
        }

        .date-filter-btn {
          width: 100%;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid #e9e9e7;
          background: #ffffff;
          cursor: pointer;
          color: #2f2f2f;
        }

        .date-filter-btn.open {
          border-color: rgba(109, 91, 208, 0.4);
          box-shadow: 0 0 0 3px rgba(109, 91, 208, 0.12);
        }

        .date-filter-value {
          font-size: 13px;
          color: #37352f;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .date-filter-popover {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 50;
          width: 360px;
          max-width: calc(100vw - 48px);
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 10px;
          box-shadow: 0 18px 44px rgba(15, 15, 15, 0.12);
          padding: 12px;
        }

        .preset-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }

        .preset-btn {
          border: 1px solid #e9e9e7;
          background: #fcfcfb;
          color: #37352f;
          border-radius: 8px;
          padding: 10px 10px;
          font-size: 12px;
          cursor: pointer;
          text-align: center;
        }

        .preset-btn.active {
          border-color: rgba(109, 91, 208, 0.6);
          background: rgba(109, 91, 208, 0.08);
          color: #2f2f2f;
          font-weight: 600;
        }

        .custom-range {
          border-top: 1px solid #f1f1ef;
          padding-top: 12px;
        }

        .custom-inputs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 10px;
        }

        .custom-label {
          font-size: 12px;
          color: #787774;
          display: grid;
          gap: 6px;
        }

        .custom-label input {
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          padding: 9px 10px;
          font-size: 13px;
          color: #2f2f2f;
          background: #ffffff;
        }

        .date-error {
          font-size: 12px;
          color: #dc2626;
          margin-bottom: 10px;
        }

        .custom-actions {
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }

        .btn-ghost {
          padding: 9px 12px;
          border-radius: 8px;
          border: 1px solid #e9e9e7;
          background: #ffffff;
          cursor: pointer;
          font-size: 13px;
          color: #37352f;
        }

        .btn-apply {
          padding: 9px 12px;
          border-radius: 8px;
          border: 1px solid rgba(109, 91, 208, 0.55);
          background: rgba(109, 91, 208, 0.12);
          cursor: pointer;
          font-size: 13px;
          color: #2f2f2f;
          font-weight: 600;
        }

        .btn-apply:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 20px;
          border-bottom: 1px solid #f1f1ef;
          background: #fafafa;
        }

        .card-title {
          font-size: 14px;
          font-weight: 600;
          color: #37352f;
          margin: 0;
        }

        .card-content {
          padding: 20px;
        }

        .metric-item {
          margin-bottom: 20px;
        }

        .metric-item:last-child {
          margin-bottom: 0;
        }

        .metric-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 8px;
        }

        .metric-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .metric-bar-container {
          flex: 1;
          height: 24px;
          background: #f1f1ef;
          border-radius: 4px;
          overflow: hidden;
        }

        .metric-bar {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 4px;
        }

        .metric-bar.status-healthy {
          background: var(--app-accent);
        }

        .metric-bar.status-warning {
          background: #f59e0b;
        }

        .metric-bar.status-critical {
          background: #ef4444;
        }

        .metric-bar.status-error {
          background: #dc2626;
        }

        .metric-value {
          font-size: 14px;
          font-weight: 600;
          color: #37352f;
          min-width: 50px;
          text-align: right;
        }

        .metric-value-large {
          font-size: 24px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 4px;
        }

        .metric-hint {
          font-size: 12px;
          color: #787774;
          margin-top: 4px;
        }

        .disk-info {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-top: 16px;
        }

        .disk-stat {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .disk-stat-label {
          font-size: 11px;
          font-weight: 600;
          color: #787774;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .disk-stat-value {
          font-size: 16px;
          font-weight: 600;
          color: #37352f;
        }

        .service-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .service-item {
          display: grid;
          grid-template-columns: 120px auto 1fr;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #fafafa;
          border-radius: 4px;
        }

        .service-name {
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
        }

        .service-badge {
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }

        .service-badge.status-healthy {
          background: var(--app-accent-soft-bg);
          color: var(--app-accent-hover);
        }

        .service-badge.status-warning {
          background: #fef3c7;
          color: #92400e;
        }

        .service-badge.status-critical,
        .service-badge.status-error {
          background: #fee2e2;
          color: #991b1b;
        }

        .service-badge.status-unknown {
          background: #f3f4f6;
          color: #6b7280;
        }

        .service-message {
          font-size: 12px;
          color: #787774;
          grid-column: 2 / -1;
        }

        .service-hint {
          font-size: 11px;
          color: #9b9a97;
          grid-column: 3;
          text-align: right;
        }

        .network-interfaces {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .interface-badge {
          padding: 4px 12px;
          background: #f7f6f3;
          border: 1px solid #e9e9e7;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          color: #37352f;
          font-family: monospace;
        }

        .process-table-wrapper {
          overflow-x: auto;
          max-height: 400px;
          overflow-y: auto;
        }

        .process-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .process-table thead {
          position: sticky;
          top: 0;
          background: #fafafa;
          z-index: 1;
        }

        .process-table th {
          text-align: left;
          padding: 8px 12px;
          font-weight: 600;
          color: #787774;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.4px;
          border-bottom: 2px solid #e9e9e7;
        }

        .process-table td {
          padding: 8px 12px;
          border-bottom: 1px solid #f1f1ef;
          color: #37352f;
        }

        .process-table tbody tr:hover {
          background: #f7f6f3;
        }

        .process-pid {
          font-family: monospace;
          color: #6b6a66;
        }

        .process-metric {
          font-family: monospace;
          font-weight: 500;
        }

        .process-command {
          font-family: monospace;
          font-size: 11px;
          color: #6b6a66;
          max-width: 400px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 768px) {
          .settings-container {
            padding: 20px;
          }

          .metrics-grid {
            grid-template-columns: 1fr;
          }

          .service-item {
            grid-template-columns: 1fr;
          }

          .service-message,
          .service-hint {
            grid-column: 1;
          }

          .disk-info {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

