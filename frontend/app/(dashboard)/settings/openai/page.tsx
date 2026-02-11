'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DashboardLayout from '@/components/DashboardLayout'
import apiClient from '@/lib/api-client'
import { useOpenAITestConnection } from '@/hooks/use-calls'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { buildApiUrl } from '@/lib/api-helpers'
import { useSelectedUser } from '@/hooks/use-selected-user'
import { useUser } from '@/hooks/use-user'
import { isSuperAdmin as isSuperAdminUser } from '@/lib/permissions'
import { useOpenAIUsageHistory } from '@/hooks/use-openai-usage'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'

interface OpenAISettings {
  enabled: boolean
  whisperModel: string
  gptModel: string
  hasApiKey: boolean
  analysisPrompt: string
  whisperPricePerMinute?: number | null
  whisperOurPricePerMinute?: number | null
}

type DatePreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'allTime' | 'custom'

const startOfDayISO = (date: Date): string => {
  const copy = new Date(date)
  // Use UTC boundaries to match OpenAI Usage dashboard (UTC).
  copy.setUTCHours(0, 0, 0, 0)
  return copy.toISOString()
}

const endOfDayISO = (date: Date): string => {
  const copy = new Date(date)
  // Use UTC boundaries to match OpenAI Usage dashboard (UTC).
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
    case 'allTime': {
      return { start: null, end: null, label: 'All time' }
    }
    default:
      return { start: startOfDayISO(today), end, label: 'Custom range' }
  }
}

const DEFAULT_ANALYSIS_PROMPT = `You are an AI call analyst. Using the transcript below, generate a structured report.

TRANSCRIPT:
"\${transcript}"

IMPORTANT: Format your response EXACTLY as follows, with each section on a new line starting with the number:

1. **Full Transcript**
[Print the full transcript text exactly as provided. Print it as a dialog with each participant on a new line.]

2. **Summary**
[2-3 sentence summary of the conversation]

3. **Action Items**
[Bulleted list of short action items, one per line starting with - ]

4. **Sentiment**
[One word: positive, negative, or neutral]

5. **Urgent Topics**
[List any urgent topics, or "None" if there are none]

6. **Booking**
[If this call contains an actual conversation of a person trying to book a new booking and is successful, label it Booked. I this call contains an actual conversation of a person trying to book but the booking is unsuccessful, label it Not Booked. If this call contains a conversation of a person rescheduling a booking, label it Rescheduled. If this call contains a conversation of a person canceling a booking, label it Canceled. If this call is related to something other than booking, leave this value blank.]

Make sure each section starts with its number (2., 3., 4., 5., 6.) on a new line and is clearly separated.`

const defaultSettings: OpenAISettings = {
  enabled: false,
  whisperModel: 'whisper-1',
  gptModel: 'gpt-4o-mini',
  hasApiKey: false,
  analysisPrompt: DEFAULT_ANALYSIS_PROMPT,
  whisperPricePerMinute: null,
  whisperOurPricePerMinute: null,
}

const WHISPER_MODELS = ['whisper-1']
const GPT_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']

export default function OpenAISettingsPage() {
  const { data: session, status } = useSession()
  const { selectedUserId, selectedUserEmail } = useAdminUser()
  const { data: currentUser } = useUser()
  const { data: user, isLoading: isUserLoading, error: userError } = useSelectedUser()
  const queryClient = useQueryClient()
  const testConnectionMutation = useOpenAITestConnection()

  // Platform settings are editable only for true super admins, and only when not "viewing as admin" for another user.
  const isSuperAdmin = isSuperAdminUser(currentUser)
  const isViewingOtherUser = Boolean(selectedUserId && currentUser?.id && selectedUserId !== currentUser.id)

  const [usageScope, setUsageScope] = useState<'mine' | 'all'>('mine')
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')
  const [dateRange, setDateRange] = useState(() => getPresetRange('last7'))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const datePickerRef = useRef<HTMLDivElement | null>(null)
  const didInitUsageDefaultsRef = useRef(false)
  const prevViewedUserIdRef = useRef<string | null>(null)

  const [form, setForm] = useState({
    ...defaultSettings,
    apiKey: '',
    apiKeyChanged: false,
    whisperPricePerMinuteInput: '',
    whisperOurPricePerMinuteInput: '',
  })
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  useEffect(() => {
    if (user?.openaiSettings) {
      const rawPrice = (user.openaiSettings as any).whisperPricePerMinute
      const whisperPricePerMinuteInput =
        typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice >= 0 ? String(rawPrice) : ''

      const rawOurPrice = (user.openaiSettings as any).whisperOurPricePerMinute
      const whisperOurPricePerMinuteInput =
        typeof rawOurPrice === 'number' && Number.isFinite(rawOurPrice) && rawOurPrice >= 0 ? String(rawOurPrice) : ''
      setForm({
        enabled: user.openaiSettings.enabled ?? false,
        whisperModel: user.openaiSettings.whisperModel || 'whisper-1',
        gptModel: user.openaiSettings.gptModel || 'gpt-4o-mini',
        hasApiKey: user.openaiSettings.hasApiKey ?? false,
        analysisPrompt: user.openaiSettings.analysisPrompt || DEFAULT_ANALYSIS_PROMPT,
        apiKey: '',
        apiKeyChanged: false,
        whisperPricePerMinuteInput,
        whisperOurPricePerMinuteInput,
      })
    }
  }, [user?.openaiSettings])

  useEffect(() => {
    // If switching into "view as user", force scope to user-only.
    if (isViewingOtherUser) {
      setUsageScope('mine')
    }
  }, [isViewingOtherUser])

  useEffect(() => {
    // When switching the viewed user, default the range to Last 7 days.
    if (!isViewingOtherUser) {
      prevViewedUserIdRef.current = null
      return
    }

    const nextViewed = selectedUserId ? String(selectedUserId) : null
    const prevViewed = prevViewedUserIdRef.current
    if (nextViewed && nextViewed !== prevViewed) {
      prevViewedUserIdRef.current = nextViewed
      setDatePreset('last7')
      setDateRange(getPresetRange('last7'))
      setCustomStart('')
      setCustomEnd('')
      setDateError(null)
    }
  }, [isViewingOtherUser, selectedUserId])

  useEffect(() => {
    // Super admin default: All users + Last 7 days (only when not viewing another user).
    // Only apply once per page load so we don't override user changes.
    if (didInitUsageDefaultsRef.current) return
    if (!isSuperAdmin || !currentUser?.id) return
    if (isViewingOtherUser) return

    didInitUsageDefaultsRef.current = true
    setUsageScope('all')
    setDatePreset('last7')
    setDateRange(getPresetRange('last7'))
  }, [isSuperAdmin, currentUser?.id, isViewingOtherUser])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setIsDatePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const usageQuery = useQuery({
    queryKey: [
      'openai-usage-summary',
      {
        viewingUserId: isViewingOtherUser ? selectedUserId : null,
        scope: isViewingOtherUser ? 'user' : usageScope,
        start: dateRange.start,
        end: dateRange.end,
      },
    ],
    enabled: Boolean(isSuperAdmin && currentUser?.id),
    queryFn: async () => {
      const url = buildApiUrl('/api/v1/integrations/openai/usage-summary', isViewingOtherUser ? selectedUserId : null)
      const params: any = {}
      if (dateRange.start) params.startDate = dateRange.start
      if (dateRange.end) params.endDate = dateRange.end
      if (!isViewingOtherUser && usageScope === 'all') params.scope = 'all'
      const { data } = await apiClient.get(url, { params })
      return data as {
        callCount: number
        audioSeconds: number
        audioMinutes: number
        whisperModelRequests: number
        gptInputTokens: number
        gptOutputTokens: number
        gptTotalTokens: number
        whisperPricePerMinute: number | null
        whisperEstimatedSpend: number
        whisperOurPricePerMinute: number | null
        whisperOurEstimatedCharge: number
        scope: 'all' | 'user'
        userId: string | null
        startDate: string | null
        endDate: string | null
      }
    },
  })

  const usageHistoryQuery = useOpenAIUsageHistory({
    viewingUserId: isViewingOtherUser ? selectedUserId : null,
    scope: !isViewingOtherUser && usageScope === 'all' ? 'all' : 'user',
    startDate: dateRange.start,
    endDate: dateRange.end,
    enabled: Boolean(isSuperAdmin && currentUser?.id),
  })

  if (status === 'loading' || isUserLoading) {
    return (
      <DashboardLayout>
        <div className="page-header">
          <h1 className="page-title">OpenAI Integration</h1>
          <p className="page-subtitle">Loading...</p>
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
          <h1 className="page-title">OpenAI Integration</h1>
          <p className="page-subtitle">Unable to load user profile. Please refresh and try again.</p>
        </div>
      </DashboardLayout>
    )
  }

  const handleFieldChange = (key: string, value: string | boolean) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'apiKey' && { apiKeyChanged: true }),
    }))
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

    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
    const startLabel = dateRange.start ? formatter.format(new Date(dateRange.start)) : '...'
    const endLabel = dateRange.end ? formatter.format(new Date(dateRange.end)) : '...'
    return `${startLabel} – ${endLabel}`
  }

  const handlePresetSelect = (preset: DatePreset) => {
    setDateError(null)
    setDatePreset(preset)
    if (preset === 'custom') {
      // Keep popover open so user can pick dates
      return
    }
    setDateRange(getPresetRange(preset))
    setIsDatePickerOpen(false)
  }

  const handleApplyCustomRange = () => {
    if (!customStart || !customEnd) {
      setDateError('Select both start and end dates')
      return
    }

    // Interpret selected calendar dates as UTC to match OpenAI dashboard.
    const startDate = new Date(`${customStart}T00:00:00.000Z`)
    const endDate = new Date(`${customEnd}T23:59:59.999Z`)

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

  const handleTestConnection = async () => {
    if (!form.apiKey && !form.hasApiKey) {
      setMessage('Please enter an API key to test the connection')
      setMessageType('error')
      return
    }

    setMessage('')
    
    try {
      await testConnectionMutation.mutateAsync({
        apiKey: form.apiKey || undefined,
        whisperModel: form.whisperModel,
        gptModel: form.gptModel,
      })
      setMessage('Successfully connected to OpenAI API')
      setMessageType('success')
    } catch (error: any) {
      console.error('Test connection error:', error)
      
      // Extract error message from various possible formats
      let errorMessage = 'Connection test failed'
      
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message
      } else if (error.message) {
        errorMessage = error.message
      }
      
      setMessage(errorMessage)
      setMessageType('error')
    } finally {
      setTimeout(() => {
        if (messageType === 'error') {
          setMessage('')
        }
      }, 5000)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setMessage('')

    try {
      const whisperPricePerMinuteInput = String((form as any).whisperPricePerMinuteInput || '').trim()
      const whisperPricePerMinute =
        whisperPricePerMinuteInput.length > 0 ? Number.parseFloat(whisperPricePerMinuteInput) : null

      const whisperOurPricePerMinuteInput = String((form as any).whisperOurPricePerMinuteInput || '').trim()
      const whisperOurPricePerMinute =
        whisperOurPricePerMinuteInput.length > 0 ? Number.parseFloat(whisperOurPricePerMinuteInput) : null

      const payload: any = {
        enabled: form.enabled,
        whisper_model: form.whisperModel,
        gpt_model: form.gptModel,
        analysis_prompt: form.analysisPrompt || null,
        whisper_price_per_minute:
          whisperPricePerMinute !== null && Number.isFinite(whisperPricePerMinute) && whisperPricePerMinute >= 0
            ? whisperPricePerMinute
            : null,
        whisper_our_price_per_minute:
          whisperOurPricePerMinute !== null &&
          Number.isFinite(whisperOurPricePerMinute) &&
          whisperOurPricePerMinute >= 0
            ? whisperOurPricePerMinute
            : null,
      }

      // Include API key: new value if changed, empty string to keep existing
      if (form.apiKeyChanged && form.apiKey) {
        payload.api_key = form.apiKey
      } else {
        // Send empty string to tell backend to keep existing API key
        payload.api_key = ''
      }

      const url = buildApiUrl('/api/v1/user/preferences', selectedUserId)
      await apiClient.patch(url, {
        openaiSettings: payload,
      })

      // Invalidate and refetch user data
      await queryClient.invalidateQueries({ queryKey: ['user'] })
      await queryClient.invalidateQueries({ queryKey: ['openai-usage-summary'] })

      setMessage('Settings saved successfully')
      setMessageType('success')
      
      // Reset password changed flag
      setForm((prev) => ({ ...prev, apiKeyChanged: false, apiKey: '' }))
    } catch (error: any) {
      console.error('Error saving OpenAI settings:', error)
      setMessage(error.response?.data?.error || 'Failed to save OpenAI settings.')
      setMessageType('error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="settings-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">OpenAI Integration</h1>
            <p className="page-subtitle">
              {isSuperAdmin && !isViewingOtherUser
                ? 'Configure OpenAI API credentials and default settings for all users.'
                : 'Customize your AI analysis prompt. API credentials are managed by the administrator.'}
            </p>
          </div>
          <div className="header-actions">
            {isSuperAdmin && !isViewingOtherUser && (
              <button
                type="button"
                className="ghost-btn"
                onClick={handleTestConnection}
                disabled={testConnectionMutation.isPending || (!form.apiKey && !form.hasApiKey)}
              >
                {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
              </button>
            )}
            <button
              type="button"
              className="primary-btn"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        <div className="settings-content">
          {message && (
            <div className={`settings-message ${messageType}`}>
              {message}
            </div>
          )}

          {isSuperAdmin && (
            <div className="settings-section">
              <div className="usage-header">
                <h2 className="section-title">Usage</h2>
                <div className="usage-controls">
                  {!isViewingOtherUser && (
                    <select
                      className="select-input usage-scope"
                      value={usageScope}
                      onChange={(e) => setUsageScope(e.target.value as 'mine' | 'all')}
                    >
                      <option value="mine">My FreePBX</option>
                      <option value="all">All users</option>
                    </select>
                  )}

                  {isViewingOtherUser && (
                    <div className="usage-scope-label">
                      Viewing: <strong>{selectedUserEmail || selectedUserId}</strong>
                    </div>
                  )}

                  <div className="date-filter" ref={datePickerRef}>
                    <button
                      type="button"
                      className={`date-filter-btn ${isDatePickerOpen ? 'open' : ''}`}
                      onClick={() => setIsDatePickerOpen((prev) => !prev)}
                    >
                      <div className="date-filter-text">
                        <span className="date-filter-label">Date range</span>
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

              {usageQuery.isLoading ? (
                <div className="usage-loading">Loading usage…</div>
              ) : usageQuery.isError ? (
                <div className="usage-error">Unable to load usage for this range.</div>
              ) : (
                <>
                  <div className="usage-hint">
                    Usage totals reflect only calls that were processed (transcribed/analyzed) by OpenAI.
                  </div>
                  <div className="usage-grid">
                  <div className="usage-card">
                    <div className="usage-label">Calls processed</div>
                    <div className="usage-value">{usageQuery.data?.callCount ?? 0}</div>
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">Whisper model requests</div>
                    <div className="usage-value">{usageQuery.data?.whisperModelRequests ?? 0}</div>
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">Audio minutes</div>
                    <div className="usage-value">
                      {Number.isFinite(usageQuery.data?.audioMinutes)
                        ? (usageQuery.data!.audioMinutes).toFixed(1)
                        : '0.0'}
                    </div>
                    <div className="usage-subtext">
                      {(() => {
                        const minutes = Number(usageQuery.data?.audioMinutes ?? 0)
                        const seconds = Math.max(0, Math.floor(Number(usageQuery.data?.audioSeconds ?? 0)))
                        const hours = minutes / 60
                        const secondsLabel = new Intl.NumberFormat('en-US').format(seconds)
                        const hoursLabel = Number.isFinite(hours) && hours > 0 ? hours.toFixed(1) : '0.0'
                        return `${hoursLabel} hours • ${secondsLabel} sec`
                      })()}
                    </div>
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">Whisper est. spend</div>
                    <div className="usage-value">
                      {(() => {
                        const n = Number((usageQuery.data as any)?.whisperEstimatedSpend ?? 0)
                        if (!Number.isFinite(n) || n <= 0) return '$0.00'
                        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
                      })()}
                    </div>
                    {Number.isFinite(Number((usageQuery.data as any)?.whisperPricePerMinute)) && (
                      <div className="usage-subtext">
                        @{' '}
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        }).format(Number((usageQuery.data as any).whisperPricePerMinute))}
                        /min
                      </div>
                    )}
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">Whisper our price</div>
                    <div className="usage-value">
                      {(() => {
                        const n = Number((usageQuery.data as any)?.whisperOurEstimatedCharge ?? 0)
                        if (!Number.isFinite(n) || n <= 0) return '$0.00'
                        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
                      })()}
                    </div>
                    {Number.isFinite(Number((usageQuery.data as any)?.whisperOurPricePerMinute)) && (
                      <div className="usage-subtext">
                        @{' '}
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        }).format(Number((usageQuery.data as any).whisperOurPricePerMinute))}
                        /min
                      </div>
                    )}
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">GPT input tokens</div>
                    <div className="usage-value">{usageQuery.data?.gptInputTokens ?? 0}</div>
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">GPT output tokens</div>
                    <div className="usage-value">{usageQuery.data?.gptOutputTokens ?? 0}</div>
                  </div>
                  <div className="usage-card">
                    <div className="usage-label">GPT total tokens</div>
                    <div className="usage-value">{usageQuery.data?.gptTotalTokens ?? 0}</div>
                  </div>
                  </div>

                  <div className="usage-history">
                    <div className="usage-history-title">Daily history</div>
                    <div className="usage-history-subtitle">
                      Calls processed, Whisper requests, audio minutes, and Whisper estimated spend by day (in UTC to match OpenAI stats)
                    </div>

                    {usageHistoryQuery.isLoading ? (
                      <div className="usage-history-loading">Loading history…</div>
                    ) : usageHistoryQuery.isError ? (
                      <div className="usage-history-error">Unable to load daily history for this range.</div>
                    ) : (usageHistoryQuery.data?.points || []).length === 0 ? (
                      <div className="usage-history-empty">No usage history yet for this range.</div>
                    ) : (
                      <div className="usage-chart-wrap">
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart
                            data={(usageHistoryQuery.data?.points || []).map((p) => ({
                              ...p,
                              // ensure numeric values for recharts
                              callsProcessed: Number(p.callsProcessed || 0),
                              whisperModelRequests: Number(p.whisperModelRequests || 0),
                              audioMinutes: Number(p.audioMinutes || 0),
                              whisperEstimatedSpend: Number(p.whisperEstimatedSpend || 0),
                              whisperOurEstimatedCharge: Number((p as any).whisperOurEstimatedCharge || 0),
                            }))}
                            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="day"
                              tickFormatter={(v) =>
                                new Intl.DateTimeFormat('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  timeZone: 'UTC',
                                }).format(new Date(`${String(v)}T00:00:00Z`))
                              }
                              minTickGap={18}
                            />
                            <YAxis yAxisId="left" />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              domain={[
                                0,
                                (dataMax: number) => {
                                  const m = Number(dataMax || 0)
                                  if (!Number.isFinite(m) || m <= 0) return 1
                                  return m * 1.1
                                },
                              ]}
                              tickFormatter={(v) =>
                                new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                                  Number(v || 0)
                                )
                              }
                              width={84}
                            />
                            <Tooltip
                              formatter={(value: any, name: any) => {
                                const n = Number(value || 0)
                                const key = String(name || '')
                                if (key === 'Whisper est. spend') {
                                  return [
                                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n),
                                    key,
                                  ]
                                }
                                if (key === 'Whisper our price') {
                                  return [
                                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n),
                                    key,
                                  ]
                                }
                                if (key === 'Audio' || key.startsWith('Audio ')) {
                                  const hours = n / 60
                                  const hoursFixed = Number.isFinite(hours) ? hours.toFixed(1) : '0.0'
                                  const hoursLabel = hoursFixed.endsWith('.0') ? hoursFixed.slice(0, -2) : hoursFixed
                                  return [`${n.toFixed(1)} min (${hoursLabel}h)`, key]
                                }
                                return [new Intl.NumberFormat('en-US').format(Math.round(n)), key]
                              }}
                              labelFormatter={(label: any) =>
                                new Intl.DateTimeFormat('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  timeZone: 'UTC',
                                }).format(new Date(`${String(label)}T00:00:00Z`))
                              }
                            />
                            <Legend
                              formatter={(value: any) => {
                                const label = String(value || '')
                                if (!dateRange.start || !dateRange.end) return label

                                const startMs = new Date(dateRange.start).getTime()
                                const endMs = new Date(dateRange.end).getTime()
                                if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
                                  return label
                                }

                                const msPerDay = 24 * 60 * 60 * 1000
                                const dayCount = Math.floor((endMs - startMs) / msPerDay) + 1
                                if (!Number.isFinite(dayCount) || dayCount <= 0) return label

                                if (label === 'Audio') {
                                  const totalSeconds = Number(usageQuery.data?.audioSeconds ?? 0)
                                  const avgHours = totalSeconds / 3600 / dayCount
                                  const avgLabel = Number.isFinite(avgHours) && avgHours > 0 ? avgHours.toFixed(1) : '0.0'
                                  return `Audio avg ${avgLabel}h`
                                }

                                if (label === 'Calls processed') {
                                  const total = Number(usageQuery.data?.callCount ?? 0)
                                  const avg = Math.ceil((Number.isFinite(total) ? total : 0) / dayCount)
                                  return `Calls processed avg ${avg}`
                                }

                                if (label === 'Whisper requests') {
                                  const total = Number(usageQuery.data?.whisperModelRequests ?? 0)
                                  const avg = Math.ceil((Number.isFinite(total) ? total : 0) / dayCount)
                                  return `Whisper requests avg ${avg}`
                                }

                                if (label === 'Whisper est. spend') {
                                  const total = Number((usageQuery.data as any)?.whisperEstimatedSpend ?? 0)
                                  const avg = (Number.isFinite(total) ? total : 0) / dayCount
                                  const avgLabel = new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }).format(avg)
                                  return `Whisper est. spend avg ${avgLabel}/day`
                                }

                                if (label === 'Whisper our price') {
                                  const total = Number((usageQuery.data as any)?.whisperOurEstimatedCharge ?? 0)
                                  const avg = (Number.isFinite(total) ? total : 0) / dayCount
                                  const avgLabel = new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }).format(avg)
                                  return `Whisper our price avg ${avgLabel}/day`
                                }

                                return label
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="callsProcessed"
                              name="Calls processed"
                              stroke="#6D5BD0"
                              strokeWidth={2}
                              dot={false}
                              yAxisId="left"
                            />
                            <Line
                              type="monotone"
                              dataKey="whisperModelRequests"
                              name="Whisper requests"
                              stroke="#10B981"
                              strokeWidth={2}
                              dot={false}
                              yAxisId="left"
                            />
                            <Line
                              type="monotone"
                              dataKey="audioMinutes"
                              name="Audio"
                              stroke="#F59E0B"
                              strokeWidth={2}
                              dot={false}
                              yAxisId="left"
                            />
                            <Line
                              type="monotone"
                              dataKey="whisperEstimatedSpend"
                              name="Whisper est. spend"
                              stroke="#EF4444"
                              strokeWidth={2}
                              dot={false}
                              yAxisId="right"
                            />
                            <Line
                              type="monotone"
                              dataKey="whisperOurEstimatedCharge"
                              name="Whisper our price"
                              stroke="#3B82F6"
                              strokeWidth={2}
                              dot={false}
                              yAxisId="right"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Show full settings for superadmin only */}
          {isSuperAdmin && !isViewingOtherUser && (
            <div className="settings-section">
              <h2 className="section-title">Platform Settings (All Users)</h2>
              <div className="info-banner">
                <strong>ℹ️ Administrator Settings:</strong> These API credentials and models will be used for all users across the platform. Individual users can customize their analysis prompts.
              </div>

              <div className="setting-item">
                <div className="setting-label">Integration Status</div>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => handleFieldChange('enabled', e.target.checked)}
                  />
                  <span className="toggle-slider" />
                  <span className="toggle-label">
                    {form.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
                <div className="setting-hint">
                  When enabled, all calls will be transcribed and analyzed using OpenAI.
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-label">OpenAI API Key</div>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => handleFieldChange('apiKey', e.target.value)}
                  placeholder={form.hasApiKey ? '••••••••••••••••' : 'sk-...'}
                  className="text-input"
                />
                <div className="setting-hint">
                  Get your API key from{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-btn"
                  >
                    OpenAI Platform
                  </a>
                </div>
              </div>

              <div className="settings-grid">
                <div>
                  <div className="setting-label">Whisper price per minute (USD)</div>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={String((form as any).whisperPricePerMinuteInput || '')}
                    onChange={(e) => setForm((prev) => ({ ...prev, whisperPricePerMinuteInput: e.target.value }))}
                    placeholder="0.006"
                    className="text-input"
                  />
                  <div className="setting-hint">Used for spend estimation in the Usage panel.</div>
                </div>

                <div>
                  <div className="setting-label">Whisper per minute our price (USD)</div>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={String((form as any).whisperOurPricePerMinuteInput || '')}
                    onChange={(e) => setForm((prev) => ({ ...prev, whisperOurPricePerMinuteInput: e.target.value }))}
                    placeholder="0.015"
                    className="text-input"
                  />
                  <div className="setting-hint">Used for “Whisper our price” totals in the Usage panel.</div>
                </div>

                <div>
                  <div className="setting-label">Whisper Model</div>
                  <select
                    value={form.whisperModel}
                    onChange={(e) => handleFieldChange('whisperModel', e.target.value)}
                    className="select-input"
                  >
                    {WHISPER_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <div className="setting-hint">Model used for audio transcription.</div>
                </div>

                <div>
                  <div className="setting-label">GPT Model</div>
                  <select
                    value={form.gptModel}
                    onChange={(e) => handleFieldChange('gptModel', e.target.value)}
                    className="select-input"
                  >
                    {GPT_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <div className="setting-hint">Model used for call analysis and summaries.</div>
                </div>
              </div>
            </div>
          )}

          {/* Show prompt customization for everyone */}
          <div className="settings-section">
            <h2 className="section-title">
              {isSuperAdmin && !isViewingOtherUser ? 'Default Analysis Prompt' : 'Custom Analysis Prompt'}
            </h2>
            {!isSuperAdmin && (
              <div className="info-banner">
                <strong>ℹ️ Custom Prompt:</strong> Customize how AI analyzes your call transcripts. The API credentials and models are managed by your administrator.
              </div>
            )}

            <div className="setting-item prompt-section">
              <div className="setting-label">Analysis Prompt</div>
              
              {/* Default Prompt Reference */}
              <div className="default-prompt-reference">
                <button
                  type="button"
                  className="prompt-toggle-btn"
                  onClick={() => setShowDefaultPrompt(!showDefaultPrompt)}
                >
                  {showDefaultPrompt ? '▼' : '▶'} Default Prompt Template (Click to {showDefaultPrompt ? 'hide' : 'show'})
                </button>
                
                {showDefaultPrompt && (
                  <div className="default-prompt-display">
                    <pre className="prompt-preview">{DEFAULT_ANALYSIS_PROMPT}</pre>
                    <button
                      type="button"
                      className="copy-prompt-btn"
                      onClick={() => {
                        handleFieldChange('analysisPrompt', DEFAULT_ANALYSIS_PROMPT)
                        setShowDefaultPrompt(false)
                      }}
                    >
                      Copy to Editor
                    </button>
                  </div>
                )}
              </div>

              <textarea
                value={form.analysisPrompt}
                onChange={(e) => handleFieldChange('analysisPrompt', e.target.value)}
                placeholder="Enter your custom analysis prompt..."
                className="prompt-textarea"
                rows={12}
              />
              <div className="prompt-info">
                <span className="char-count">
                  {form.analysisPrompt.length} characters
                  {form.analysisPrompt.length > 2000 && (
                    <span className="warning-text"> (⚠️ Very long prompt may increase costs)</span>
                  )}
                </span>
                <button
                  type="button"
                  className="reset-prompt-btn"
                  onClick={() => handleFieldChange('analysisPrompt', DEFAULT_ANALYSIS_PROMPT)}
                >
                  Reset to Default
                </button>
              </div>
              <div className="setting-hint">
                Customize how AI analyzes call transcripts. Use <code>${'{transcript}'}</code> as a placeholder for the actual transcript text. If left empty, the default prompt will be used.
              </div>
            </div>
          </div>

          <div className="info-card">
            <h3>💡 About OpenAI Integration</h3>
            <ul>
              {isSuperAdmin && !isViewingOtherUser ? (
                <>
                  <li>Your API key is securely encrypted and shared across all user accounts.</li>
                  <li><strong>Whisper</strong> is used to transcribe call recordings into text.</li>
                  <li><strong>GPT</strong> models analyze transcripts to generate summaries, action items, and sentiment.</li>
                  <li>The models you configure here apply to all users on the platform.</li>
                  <li>Individual users can customize their analysis prompts to suit their needs.</li>
                  <li>Usage costs are billed directly to your OpenAI account based on platform-wide API usage.</li>
                </>
              ) : (
                <>
                  <li>API credentials and models are managed by your system administrator.</li>
                  <li>You can customize the analysis prompt to match your business needs.</li>
                  <li>Use <code>${'{transcript}'}</code> in your prompt as a placeholder for the call transcript.</li>
                  <li><strong>Whisper</strong> transcribes call recordings, and <strong>GPT</strong> analyzes them.</li>
                  <li>Your custom prompt is applied to all your calls automatically.</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </div>

      <style jsx>{`
        .settings-container {
          width: 100%;
          padding: 18px 32px 32px;
        }
        .page-header {
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        .page-title {
          font-size: 17px;
          font-weight: 600;
          color: #2f2f2f;
          margin-bottom: 4px;
          letter-spacing: -0.2px;
        }
        .page-subtitle {
          color: #787774;
          font-size: 13px;
        }
        .header-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .settings-message {
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 24px;
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
        .settings-section {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 24px;
          margin-bottom: 24px;
        }
        .usage-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }
        .usage-controls {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .usage-scope {
          max-width: 180px;
        }
        .usage-scope-label {
          font-size: 13px;
          color: #37352f;
          background: #f7f6f3;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 8px 10px;
        }
        .usage-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .usage-hint {
          font-size: 12px;
          color: #787774;
          margin: -6px 0 10px;
        }
        .usage-card {
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          padding: 14px 16px;
          background: #fcfcfb;
        }
        .usage-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #787774;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .usage-value {
          font-size: 20px;
          font-weight: 700;
          color: #2f2f2f;
        }
        .usage-subtext {
          margin-top: 6px;
          font-size: 12px;
          color: #787774;
        }
        .usage-loading,
        .usage-error {
          font-size: 13px;
          color: #787774;
          padding: 10px 0 2px;
        }
        .usage-history {
          margin-top: 16px;
          border-top: 1px solid #f1f1ee;
          padding-top: 16px;
        }
        .usage-history-title {
          font-size: 13px;
          font-weight: 700;
          color: #2f2f2f;
          margin-bottom: 4px;
        }
        .usage-history-subtitle {
          font-size: 12px;
          color: #787774;
          margin-bottom: 10px;
        }
        .usage-history-loading,
        .usage-history-error,
        .usage-history-empty {
          font-size: 13px;
          color: #787774;
          padding: 10px 0 2px;
        }
        .usage-chart-wrap {
          width: 100%;
          height: 280px;
        }
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
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 0 12px;
          cursor: pointer;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          height: 40px;
        }
        .date-filter-btn:hover,
        .date-filter-btn.open {
          border-color: #d1d1cf;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
          background: #fcfcfb;
        }
        .date-filter-text {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }
        .date-filter-label {
          font-size: 11px;
          text-transform: uppercase;
          color: #787774;
          letter-spacing: 0.3px;
          font-weight: 600;
        }
        .date-filter-value {
          font-size: 13px;
          color: #37352f;
          font-weight: 500;
        }
        .date-filter-icon {
          color: #787774;
          transition: transform 0.18s ease;
        }
        .date-filter-popover {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 320px;
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
          padding: 14px;
          z-index: 110;
        }
        .preset-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }
        .preset-btn {
          border: 1px solid #e9e9e7;
          background: #fafaf8;
          border-radius: 6px;
          padding: 10px;
          text-align: left;
          font-size: 13px;
          color: #37352f;
          cursor: pointer;
          transition: all 0.16s ease;
        }
        .preset-btn:hover {
          border-color: #d1d1cf;
          background: #ffffff;
        }
        .preset-btn.active {
          border-color: #4f46e5;
          background: #eef2ff;
          color: #312e81;
          box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.25);
        }
        .custom-range {
          border-top: 1px solid #f1f1ee;
          padding-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .custom-inputs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .custom-label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          color: #787774;
          font-weight: 600;
          letter-spacing: 0.2px;
        }
        .custom-label input {
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 8px;
          font-size: 13px;
          color: #37352f;
        }
        .custom-label input:focus {
          outline: none;
          border-color: #4f46e5;
          box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.12);
        }
        .custom-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .btn-ghost {
          border: 1px solid #e9e9e7;
          background: #ffffff;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 13px;
          color: #37352f;
          cursor: pointer;
        }
        .btn-apply {
          border: 1px solid #4f46e5;
          background: #4f46e5;
          color: #ffffff;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          min-width: 90px;
          transition: background 0.16s ease, border-color 0.16s ease;
        }
        .btn-apply:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-apply:not(:disabled):hover {
          background: #4338ca;
          border-color: #4338ca;
        }
        .date-error {
          color: #b91c1c;
          font-size: 12px;
        }
        .settings-card {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .setting-item {
          padding: 18px 0;
          border-bottom: 1px solid #f1f1ef;
        }
        .setting-item:first-child {
          padding-top: 0;
        }
        .setting-item:last-child {
          padding-bottom: 0;
          border-bottom: none;
        }
        .setting-label {
          font-size: 13px;
          font-weight: 600;
          color: #37352f;
          margin-bottom: 8px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .setting-hint {
          font-size: 12px;
          color: #787774;
          line-height: 1.5;
          margin-top: 8px;
        }
        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-top: 12px;
        }
        .text-input,
        .select-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e1e0dd;
          border-radius: 6px;
          font-size: 14px;
        }
        .text-input:focus,
        .select-input:focus {
          outline: none;
          border-color: #a1a09c;
          box-shadow: 0 0 0 1px #d6d5d2;
        }
        .toggle-control {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          position: relative;
        }
        .toggle-control input {
          position: absolute;
          opacity: 0;
        }
        .toggle-slider {
          width: 42px;
          height: 24px;
          background: #dcdad7;
          border-radius: 999px;
          position: relative;
          transition: background 0.2s ease;
        }
        .toggle-slider::after {
          content: '';
          position: absolute;
          width: 18px;
          height: 18px;
          background: #ffffff;
          border-radius: 50%;
          top: 3px;
          left: 3px;
          transition: transform 0.2s ease;
        }
        .toggle-control input:checked + .toggle-slider {
          background: var(--app-accent);
        }
        .toggle-control input:checked + .toggle-slider::after {
          transform: translateX(18px);
        }
        .toggle-label {
          font-size: 13px;
          color: #37352f;
        }
        .link-btn {
          background: none;
          border: none;
          color: var(--app-accent);
          font-size: 12px;
          cursor: pointer;
          padding: 0;
          text-decoration: none;
        }
        .info-card {
          padding: 16px;
          background-color: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #dee2e6;
        }
        .info-card h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .info-card ul {
          margin-left: 20px;
          font-size: 14px;
          color: #495057;
          line-height: 1.6;
        }
        .info-card code {
          background: #f7f6f3;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
          font-family: monospace;
          color: #d1242f;
        }
        .info-banner {
          padding: 12px 16px;
          background: #e7f3ff;
          border: 1px solid #b3d9ff;
          border-radius: 6px;
          margin-bottom: 20px;
          font-size: 13px;
          color: #0c5460;
          line-height: 1.5;
        }
        .info-banner strong {
          color: #004085;
        }
        .ghost-btn {
          padding: 10px 20px;
          border: 1px solid #d7d5d1;
          background: #fff;
          border-radius: 6px;
          font-size: 14px;
          color: #37352f;
          cursor: pointer;
          min-width: 110px;
          text-align: center;
        }
        .ghost-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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
        .prompt-section {
          padding-top: 24px !important;
          border-top: 2px solid #e9e9e7 !important;
        }
        .default-prompt-reference {
          margin-bottom: 16px;
          padding: 12px;
          background: #f7f6f3;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
        }
        .prompt-toggle-btn {
          background: none;
          border: none;
          color: var(--app-accent);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          padding: 4px 0;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .prompt-toggle-btn:hover {
          text-decoration: underline;
        }
        .default-prompt-display {
          margin-top: 12px;
          position: relative;
        }
        .prompt-preview {
          background: #ffffff;
          border: 1px solid #e1e0dd;
          border-radius: 6px;
          padding: 12px;
          font-size: 12px;
          line-height: 1.6;
          color: #37352f;
          overflow-x: auto;
          max-height: 300px;
          overflow-y: auto;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          white-space: pre-wrap;
        }
        .copy-prompt-btn {
          margin-top: 8px;
          padding: 6px 12px;
          background: var(--app-accent);
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
        }
        .copy-prompt-btn:hover {
          background: var(--app-accent-hover);
        }
        .prompt-textarea {
          width: 100%;
          padding: 12px;
          border: 1px solid #e1e0dd;
          border-radius: 6px;
          font-size: 13px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          line-height: 1.6;
          resize: vertical;
          min-height: 300px;
        }
        .prompt-textarea:focus {
          outline: none;
          border-color: var(--app-accent);
          box-shadow: 0 0 0 3px var(--app-accent-ring);
        }
        .prompt-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
          padding: 8px 0;
        }
        .char-count {
          font-size: 12px;
          color: #787774;
        }
        .warning-text {
          color: #f59e0b;
          font-weight: 500;
        }
        .reset-prompt-btn {
          padding: 6px 12px;
          background: none;
          border: 1px solid #d7d5d1;
          border-radius: 4px;
          font-size: 12px;
          color: #37352f;
          cursor: pointer;
        }
        .reset-prompt-btn:hover {
          background: #f7f6f3;
        }
        .setting-hint code {
          background: #f7f6f3;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-family: monospace;
          color: #d1242f;
        }
        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-actions {
            width: 100%;
          }
          .usage-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .date-filter {
            min-width: 0;
            max-width: 100%;
          }
          .date-filter-popover {
            width: 100%;
            right: auto;
            left: 0;
          }
          .prompt-info {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
        }
      `}</style>
    </DashboardLayout>
  )
}

