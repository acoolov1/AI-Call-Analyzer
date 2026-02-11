'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { buildApiUrl } from '@/lib/api-helpers'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { useSelectedUser } from '@/hooks/use-selected-user'
import { useUser } from '@/hooks/use-user'
import { isSuperAdmin as isSuperAdminUser } from '@/lib/permissions'
import { useBillingAudioDaily, useBillingMonthlyHistory } from '@/hooks/use-billing-usage'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type DatePreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom'

const startOfDayISO = (date: Date): string => {
  const copy = new Date(date)
  copy.setUTCHours(0, 0, 0, 0)
  return copy.toISOString()
}

const endOfDayISO = (date: Date): string => {
  const copy = new Date(date)
  copy.setUTCHours(23, 59, 59, 999)
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
      start.setUTCDate(start.getUTCDate() - 6)
      return { start: startOfDayISO(start), end, label: 'Last 7 days' }
    }
    case 'thisMonth': {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
      return { start: startOfDayISO(start), end: endOfDayISO(endDate), label: 'This month' }
    }
    case 'lastMonth': {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
      const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
      return { start: startOfDayISO(start), end: endOfDayISO(endDate), label: 'Last month' }
    }
    default:
      return { start: startOfDayISO(today), end, label: 'Custom range' }
  }
}

export default function BillingPage() {
  const { status } = useSession()
  const { selectedUserId, selectedUserEmail, isViewingAsAdmin } = useAdminUser()
  const { data: currentUser } = useUser()
  const { data: user, isLoading: isUserLoading, error: userError } = useSelectedUser()
  const queryClient = useQueryClient()

  const isSuperAdmin = isSuperAdminUser(currentUser)
  const isViewingOtherUser = Boolean(selectedUserId && currentUser?.id && selectedUserId !== currentUser.id)
  const viewingUserId = isViewingOtherUser ? selectedUserId : null

  const [planForm, setPlanForm] = useState({
    basePlanMonthlyChargeUsdInput: '',
    basePlanIncludedAudioHoursInput: '',
  })
  const [planMessage, setPlanMessage] = useState<string>('')
  const [planMessageType, setPlanMessageType] = useState<'success' | 'error' | 'info'>('info')
  const [planSaving, setPlanSaving] = useState(false)

  useEffect(() => {
    const rawMonthly = (user as any)?.billingSettings?.basePlanMonthlyChargeUsd
    const rawHours = (user as any)?.billingSettings?.basePlanIncludedAudioHours
    setPlanForm({
      basePlanMonthlyChargeUsdInput:
        typeof rawMonthly === 'number' && Number.isFinite(rawMonthly) && rawMonthly >= 0 ? String(rawMonthly) : '',
      basePlanIncludedAudioHoursInput:
        typeof rawHours === 'number' && Number.isFinite(rawHours) && rawHours >= 0 ? String(rawHours) : '',
    })
  }, [user?.id, (user as any)?.billingSettings])

  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [dateRange, setDateRange] = useState(() => getPresetRange('thisMonth'))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)

  const canEditPlan = isSuperAdmin

  const dailyQuery = useBillingAudioDaily({
    viewingUserId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    enabled: Boolean(currentUser?.id),
  })

  const monthlyHistoryQuery = useBillingMonthlyHistory({
    viewingUserId,
    months: 12,
    enabled: Boolean(currentUser?.id),
  })

  const overageChargeHeaderSubtext = useMemo(() => {
    const raw = Number(monthlyHistoryQuery.data?.whisperOurPricePerMinute)
    if (!Number.isFinite(raw) || raw <= 0) return 'Charged month-end'

    const rateLabel = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(raw)
    return `Charged month-end at ${rateLabel}/min`
  }, [monthlyHistoryQuery.data?.whisperOurPricePerMinute])

  const totals = useMemo(() => {
    const pts = dailyQuery.data?.points || []
    const audioSeconds = pts.reduce((acc, p) => acc + Math.max(0, Number(p.audioSeconds || 0)), 0)
    const overageSeconds = pts.reduce((acc, p) => acc + Math.max(0, Number(p.overageSeconds || 0)), 0)
    return {
      audioSeconds,
      audioMinutes: audioSeconds / 60,
      overageSeconds,
      overageMinutes: overageSeconds / 60,
    }
  }, [dailyQuery.data?.points])

  const dayCount = useMemo(() => {
    const startMs = dateRange.start ? new Date(dateRange.start).getTime() : NaN
    const endMs = dateRange.end ? new Date(dateRange.end).getTime() : NaN
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0
    const msPerDay = 24 * 60 * 60 * 1000
    return Math.floor((endMs - startMs) / msPerDay) + 1
  }, [dateRange.start, dateRange.end])

  if (status === 'loading' || isUserLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Loading…</p>
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
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Error loading billing data. Please refresh.</p>
        </div>
      </DashboardLayout>
    )
  }

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    if (preset === 'custom') return
    setCustomStart('')
    setCustomEnd('')
    setDateError(null)
    setDateRange(getPresetRange(preset))
  }

  const handleApplyCustom = () => {
    if (!customStart || !customEnd) return
    const start = new Date(`${customStart}T00:00:00Z`)
    const end = new Date(`${customEnd}T00:00:00Z`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setDateError('Invalid dates')
      return
    }
    if (end < start) {
      setDateError('End date must be after start date')
      return
    }
    setDateError(null)
    setDateRange({ start: startOfDayISO(start), end: endOfDayISO(end), label: 'Custom range' })
  }

  const handleSavePlan = async () => {
    if (!canEditPlan) return

    setPlanSaving(true)
    setPlanMessage('')

    try {
      const monthlyRaw = planForm.basePlanMonthlyChargeUsdInput.trim()
      const hoursRaw = planForm.basePlanIncludedAudioHoursInput.trim()

      const monthly = monthlyRaw.length > 0 ? Number.parseFloat(monthlyRaw) : null
      const hours = hoursRaw.length > 0 ? Number.parseFloat(hoursRaw) : null

      const billingSettings: any = {}
      if (monthly === null || (Number.isFinite(monthly) && monthly >= 0)) {
        billingSettings.base_plan_monthly_charge_usd = monthly
      }
      if (hours === null || (Number.isFinite(hours) && hours >= 0)) {
        billingSettings.base_plan_included_audio_hours = hours
      }

      const url = buildApiUrl('/api/v1/user/preferences', viewingUserId)
      await apiClient.patch(url, { billingSettings })

      await queryClient.invalidateQueries({ queryKey: ['user'] })
      await queryClient.invalidateQueries({ queryKey: ['user', selectedUserId || 'current'] })
      await queryClient.invalidateQueries({ queryKey: ['billing-audio-daily'] })
      await queryClient.invalidateQueries({ queryKey: ['billing-monthly-history'] })

      setPlanMessage('Plan saved')
      setPlanMessageType('success')
    } catch (err: any) {
      setPlanMessage(err?.response?.data?.message || err?.response?.data?.error || 'Failed to save plan')
      setPlanMessageType('error')
    } finally {
      setPlanSaving(false)
      setTimeout(() => setPlanMessage(''), 4000)
    }
  }

  const safeUtcDayLabel = (day: any) => {
    const s = String(day || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—'
    const d = new Date(`${s}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return s
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
  }

  const safeUtcDayLabelLong = (day: any) => {
    const s = String(day || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—'
    const d = new Date(`${s}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return s
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d)
  }

  const safeUtcMonthLabel = (month: any) => {
    const s = String(month || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—'
    const d = new Date(`${s}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return s
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)
  }

  return (
    <DashboardLayout>
      <div className="billing-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Billing</h1>
            <p className="page-subtitle">
              {isViewingAsAdmin && selectedUserEmail ? `Viewing as admin: ${selectedUserEmail}` : 'Your plan and usage'}
            </p>
          </div>
        </div>

        {/* Section 1: Current Plan */}
        <div className="section">
          <div className="section-header">
            <div>
              <div className="section-title-row">
                <h2 className="section-title">Current plan</h2>
                <span className="plan-badge">Custom Plan</span>
              </div>
              <div className="section-subtitle">Base plan details and included usage</div>
            </div>
            {canEditPlan && (
              <button className="primary-btn" type="button" onClick={handleSavePlan} disabled={planSaving}>
                {planSaving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>

          {planMessage && <div className={`message ${planMessageType}`}>{planMessage}</div>}

          <div className="plan-grid">
            <div>
              <div className="field-label">Base plan monthly charge (USD)</div>
              {canEditPlan ? (
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={planForm.basePlanMonthlyChargeUsdInput}
                  onChange={(e) => setPlanForm((p) => ({ ...p, basePlanMonthlyChargeUsdInput: e.target.value }))}
                  placeholder="199.00"
                />
              ) : (
                <div className="static-value">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                    Number((user as any)?.billingSettings?.basePlanMonthlyChargeUsd ?? 0)
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="field-label">Included audio hours (per month)</div>
              {canEditPlan ? (
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={planForm.basePlanIncludedAudioHoursInput}
                  onChange={(e) => setPlanForm((p) => ({ ...p, basePlanIncludedAudioHoursInput: e.target.value }))}
                  placeholder="20"
                />
              ) : (
                <div className="static-value">
                  {Number((user as any)?.billingSettings?.basePlanIncludedAudioHours ?? 0).toFixed(1)}h
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Usage */}
        <div className="section">
          <div className="section-header">
            <div>
              <h2 className="section-title">Usage</h2>
              <div className="section-subtitle">
                Wisecall uses powerful AI to turn every phone call into a full transcript and actionable insights.
                Because longer calls require more processing, billing is per minute.
              </div>
            </div>
            <div className="range-controls">
              <select
                className="select-input"
                value={datePreset}
                onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
              >
                <option value="today">Today</option>
                <option value="last7">Last 7 days</option>
                <option value="thisMonth">This month</option>
                <option value="lastMonth">Last month</option>
                <option value="custom">Custom</option>
              </select>
              {datePreset === 'custom' && (
                <div className="custom-range">
                  <input
                    className="date-input"
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                  <span className="date-sep">–</span>
                  <input
                    className="date-input"
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                  <button className="ghost-btn" type="button" onClick={handleApplyCustom} disabled={!customStart || !customEnd}>
                    Apply
                  </button>
                </div>
              )}
            </div>
          </div>

          {dateError && <div className="message error">{dateError}</div>}

          {dailyQuery.isLoading ? (
            <div className="loading">Loading usage…</div>
          ) : dailyQuery.isError ? (
            <div className="message error">Unable to load usage for this range.</div>
          ) : (
            <>
              <div className="usage-grid">
                <div className="usage-card">
                  <div className="usage-label">Wisecall Analysis</div>
                  <div className="usage-value">
                    {(() => {
                      const minutes = Number(totals.audioMinutes ?? 0)
                      const hours = minutes / 60
                      const hoursLabel = Number.isFinite(hours) && hours > 0 ? hours.toFixed(1) : '0.0'
                      return `${hoursLabel}h`
                    })()}
                  </div>
                  <div className="usage-subtext">
                    {(() => {
                      const minutes = Number(totals.audioMinutes ?? 0)
                      const minutesLabel = Number.isFinite(minutes) && minutes > 0 ? minutes.toFixed(1) : '0.0'
                      return `${minutesLabel} min`
                    })()}
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-label">Overage</div>
                  <div className="usage-value">
                    {(() => {
                      const minutes = Number(totals.overageMinutes ?? 0)
                      const hours = minutes / 60
                      const hoursLabel = Number.isFinite(hours) && hours > 0 ? hours.toFixed(1) : '0.0'
                      return `${hoursLabel}h`
                    })()}
                  </div>
                  <div className="usage-subtext">
                    {(() => {
                      const minutes = Number(totals.overageMinutes ?? 0)
                      const minutesLabel = Number.isFinite(minutes) && minutes > 0 ? minutes.toFixed(1) : '0.0'
                      return `${minutesLabel} min`
                    })()}
                  </div>
                </div>
              </div>

              <div className="chart-wrap">
                {(dailyQuery.data?.points || []).length === 0 ? (
                  <div className="empty">No usage yet for this range.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={(dailyQuery.data?.points || []).map((p) => ({
                        ...p,
                        audioMinutes: Number(p.audioMinutes || 0),
                        overageMinutes: Number(p.overageMinutes || 0),
                      }))}
                      margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="day"
                        tickFormatter={(v) => safeUtcDayLabel(v)}
                        minTickGap={18}
                      />
                      <YAxis />
                      <Tooltip
                        formatter={(value: any, name: any) => {
                          const n = Number(value || 0)
                          const key = String(name || '')
                          if (
                            key === 'Wisecall Analysis' ||
                            key.startsWith('Wisecall Analysis ') ||
                            key === 'Overage' ||
                            key.startsWith('Overage ')
                          ) {
                            const hours = n / 60
                            const hoursFixed = Number.isFinite(hours) ? hours.toFixed(1) : '0.0'
                            const hoursLabel = hoursFixed.endsWith('.0') ? hoursFixed.slice(0, -2) : hoursFixed
                            return [`${n.toFixed(1)} min (${hoursLabel}h)`, key]
                          }
                          return [n, key]
                        }}
                        labelFormatter={(label: any) => safeUtcDayLabelLong(label)}
                      />
                      <Legend
                        itemSorter={(item: any) => {
                          const key = String(item?.value ?? item?.dataKey ?? '').trim()
                          if (key === 'Wisecall Analysis') return 0
                          if (key === 'Overage') return 1
                          return 999
                        }}
                        formatter={(value: any) => {
                          const label = String(value || '')
                          if (!dayCount || dayCount <= 0) return label

                          if (label === 'Wisecall Analysis') {
                            const avgHours = totals.audioSeconds / 3600 / dayCount
                            const avgLabel = Number.isFinite(avgHours) && avgHours > 0 ? avgHours.toFixed(1) : '0.0'
                            return `Wisecall Analysis avg ${avgLabel}h`
                          }
                          if (label === 'Overage') {
                            const avgHours = totals.overageSeconds / 3600 / dayCount
                            const avgLabel = Number.isFinite(avgHours) && avgHours > 0 ? avgHours.toFixed(1) : '0.0'
                            return `Overage avg ${avgLabel}h`
                          }
                          return label
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="audioMinutes"
                        name="Wisecall Analysis"
                        stroke="#F59E0B"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="overageMinutes"
                        name="Overage"
                        stroke="#EF4444"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>
          )}
        </div>

        {/* Section 3: Monthly history */}
        <div className="section">
          <div className="section-header">
            <div>
              <h2 className="section-title">Monthly history</h2>
              <div className="section-subtitle">Base plan charge + overage for each month</div>
            </div>
          </div>

          {monthlyHistoryQuery.isLoading ? (
            <div className="loading">Loading monthly history…</div>
          ) : monthlyHistoryQuery.isError ? (
            <div className="message error">Unable to load monthly history.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <div className="th-main">Month</div>
                      <div className="th-sub" aria-hidden="true">
                        &nbsp;
                      </div>
                    </th>
                    <th>
                      <div className="th-main">Base plan</div>
                      <div className="th-sub">Charged upfront</div>
                    </th>
                    <th>
                      <div className="th-main">Included</div>
                      <div className="th-sub" aria-hidden="true">
                        &nbsp;
                      </div>
                    </th>
                    <th>
                      <div className="th-main">Overage</div>
                      <div className="th-sub" aria-hidden="true">
                        &nbsp;
                      </div>
                    </th>
                    <th>
                      <div className="th-main">Overage charge</div>
                      <div className="th-sub">
                        {overageChargeHeaderSubtext}
                      </div>
                    </th>
                    <th>
                      <div className="th-main">Total</div>
                      <div className="th-sub" aria-hidden="true">
                        &nbsp;
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(monthlyHistoryQuery.data?.months || [])
                    .slice()
                    .sort((a, b) => String(b?.month || '').localeCompare(String(a?.month || '')))
                    .map((m) => {
                    const monthLabel = safeUtcMonthLabel(m.month)
                    return (
                      <tr key={m.month}>
                        <td>{monthLabel}</td>
                        <td>
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                            Number(m.basePlanMonthlyChargeUsd || 0)
                          )}
                        </td>
                        <td>{Number(m.basePlanIncludedAudioHours || 0).toFixed(1)}h</td>
                        <td>{Number(m.overageMinutes || 0).toFixed(1)} min</td>
                        <td>
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                            Number(m.overageChargeUsd || 0)
                          )}
                        </td>
                        <td>
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                            Number(m.totalChargeUsd || 0)
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .billing-container {
          width: 100%;
          padding: 18px 32px 32px;
        }
        .page-header {
          margin-bottom: 18px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 64px;
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
        .section {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 18px 18px 16px;
          margin-bottom: 18px;
        }
        .section-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }
        .section-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-title {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #37352f;
        }
        .section-subtitle {
          margin-top: 4px;
          font-size: 12px;
          color: #787774;
        }
        .plan-badge {
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid #e9e9e7;
          background: #f7f7f5;
          color: #37352f;
          font-weight: 600;
        }
        .plan-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .field-label {
          font-size: 12px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 6px;
        }
        .text-input,
        .select-input,
        .date-input {
          width: 100%;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 13px;
          outline: none;
        }
        .static-value {
          padding: 10px 12px;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          font-size: 13px;
          color: #37352f;
          background: #fbfbfa;
        }
        .primary-btn {
          background: var(--app-accent);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 12px 20px;
          font-size: 14px;
          cursor: pointer;
        }
        .primary-btn:hover:not(:disabled) {
          background: var(--app-accent-hover);
        }
        .primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .ghost-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .ghost-btn {
          background: transparent;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 13px;
          cursor: pointer;
        }
        .message {
          margin: 10px 0 12px;
          font-size: 13px;
        }
        .message.error {
          color: #b91c1c;
        }
        .message.success {
          color: #047857;
        }
        .range-controls {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .custom-range {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .date-sep {
          color: #787774;
          font-size: 13px;
        }
        .usage-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .usage-card {
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 12px;
          background: #ffffff;
        }
        .usage-label {
          font-size: 12px;
          font-weight: 700;
          color: #37352f;
          margin-bottom: 6px;
        }
        .usage-value {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
        }
        .usage-subtext {
          margin-top: 6px;
          font-size: 12px;
          color: #787774;
        }
        .chart-wrap {
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 10px 10px 0;
          background: #ffffff;
        }
        .loading {
          font-size: 13px;
          color: #787774;
        }
        .empty {
          font-size: 13px;
          color: #787774;
          padding: 10px;
        }
        .table-wrap {
          overflow-x: auto;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
        }
        .table th,
        .table td {
          text-align: left;
          padding: 10px 8px;
          border-bottom: 1px solid #f1f1ef;
          font-size: 13px;
          color: #37352f;
          white-space: nowrap;
        }
        .table th {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #787774;
          vertical-align: bottom;
        }
        .th-main {
          line-height: 1.2;
        }
        .th-sub {
          margin-top: 2px;
          font-size: 10px;
          color: #9a9895;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          line-height: 1.2;
        }
        @media (max-width: 900px) {
          .plan-grid {
            grid-template-columns: 1fr;
          }
          .usage-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

