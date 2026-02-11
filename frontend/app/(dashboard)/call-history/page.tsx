'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { useCdrCalls, useCdrSync, useCdrStatus, useDeleteCall, useBulkDeleteCalls } from '@/hooks/use-calls'
import { useUser } from '@/hooks/use-user'
import { useSelectedUser } from '@/hooks/use-selected-user'
import { parseAnalysis, getSentimentBadge, createPreview } from '@/lib/analysis-parser'
import { formatDateInTimezone } from '@/lib/timezone'
import { useAdminUser } from '@/contexts/AdminUserContext'
import type { Call } from '@/types/call'
import apiClient from '@/lib/api-client'
import { canUseApp } from '@/lib/permissions'

type DatePreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'allTime' | 'custom'

type DirectionFilter = 'inbound' | 'outbound' | null
type BookingFilter = 'Booked' | 'Not Booked' | 'Rescheduled' | 'Canceled' | 'unknown' | null
type SentimentFilter = 'positive' | 'neutral' | 'negative' | 'unknown' | null

type CallFilters = {
  direction: DirectionFilter
  booking: BookingFilter
  sentiment: SentimentFilter
  notAnswered: boolean
}

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

export default function CallHistoryPage() {
  const { data: session, status } = useSession()
  const { data: user } = useUser()
  const { selectedUserId } = useAdminUser()
  const { data: selectedUser } = useSelectedUser()
  const appEnabled = user ? canUseApp(user) : false
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')
  const [dateRange, setDateRange] = useState(() => getPresetRange('last7'))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const datePickerRef = useRef<HTMLDivElement | null>(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [filters, setFilters] = useState<CallFilters>({
    direction: null,
    booking: null,
    sentiment: null,
    notAnswered: false,
  })
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const loadedMetadataRef = useRef<Record<string, boolean>>({})
  const [audioTimes, setAudioTimes] = useState<Record<string, { current: number; duration: number }>>({})
  const [selectedCalls, setSelectedCalls] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSelectingAll, setIsSelectingAll] = useState(false)

  const limit = 50

  // Keep the UI responsive: filter instantly on the current page, and only
  // trigger server-side search after a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
    }, 200)
    return () => clearTimeout(t)
  }, [searchQuery])

  const { data: cdrData, isLoading, refetch } = useCdrCalls(
    currentPage,
    limit,
    selectedUserId,
    {
      startDate: dateRange.start || undefined,
      endDate: dateRange.end || undefined,
      direction: filters.direction,
      booking: filters.booking,
      sentiment: filters.sentiment,
      notAnswered: filters.notAnswered,
      search: debouncedSearch || undefined,
      enabled: appEnabled,
    }
  )
  const { data: cdrStatus, isLoading: isStatusLoading } = useCdrStatus(selectedUserId, { enabled: appEnabled })
  const syncMutation = useCdrSync(selectedUserId)
  const deleteCallMutation = useDeleteCall(selectedUserId)
  const bulkDeleteMutation = useBulkDeleteCalls(selectedUserId)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setIsDatePickerOpen(false)
      }
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    setCurrentPage(1)
    setSelectedCalls(new Set())
  }, [filters.direction, filters.booking, filters.sentiment, filters.notAnswered, debouncedSearch])

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
    if (preset === 'custom') {
      // Keep popover open so user can pick dates
      return
    }
    setDateRange(getPresetRange(preset))
    setIsDatePickerOpen(false)
    setCurrentPage(1)
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
    setCurrentPage(1)
  }

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (!user) {
    return <div>Loading...</div>
  }

  // FreePBX-only admins should land on FreePBX Manager
  if (!canUseApp(user)) {
    redirect('/settings/freepbx/user-manager')
  }

  if (isLoading) {
    return <div>Loading calls...</div>
  }

  const calls = cdrData?.calls || []
  const pagination = cdrData?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 }

  const filteredCalls = calls.filter((call: any) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const caller = `${call.callerName || ''} ${call.callerNumber}`.toLowerCase()
    const rawDst = String(call.sourceMetadata?.dst ?? '').trim()
    const dstChannel = String(call.sourceMetadata?.dstchannel ?? '')
    const parsedAnsweredExtFromChannel = (() => {
      const m = dstChannel.match(/(?:PJSIP|SIP)\/(\d{3,4})(?:-|$)/i)
      return m?.[1] ? String(m[1]).trim() : ''
    })()
    const answeredExtension =
      String(call.sourceMetadata?.answered_extension || '').trim() || parsedAnsweredExtFromChannel
    const answeredName = String(call.sourceMetadata?.answered_name || '').trim()
    const calleeName = answeredName || String(call.sourceMetadata?.dst_cnam || '').trim()
    const calleeNumber = rawDst === '0' && answeredExtension ? answeredExtension : rawDst
    const callee = `${calleeName} ${calleeNumber} ${answeredExtension} ${dstChannel}`.toLowerCase()
    const transcript = call.transcript?.toLowerCase() || ''
    const analysis = call.analysis?.toLowerCase() || ''
    const direction = String(call.direction || '').toLowerCase()
    const disposition = String(call.sourceMetadata?.disposition || '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    return (
      caller.includes(query) ||
      callee.includes(query) ||
      transcript.includes(query) ||
      analysis.includes(query) ||
      direction.includes(query) ||
      disposition.includes(query)
    )
  })

  const seedAudioDurationIfMissing = (audioId: string, durationSeconds: number) => {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
    setAudioTimes((prev) => {
      if (prev[audioId]?.duration && prev[audioId]!.duration > 0) return prev
      return {
        ...prev,
        [audioId]: {
          current: prev[audioId]?.current || 0,
          duration: durationSeconds,
        },
      }
    })
  }

  const toggleRow = (rowId: string, call: any, audioId: string) => {
    const isCollapsing = expandedRows.has(rowId)

    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })

    // On expand, seed duration from CDR fields immediately (no network).
    if (!isCollapsing) {
      const fallbackSeconds = Number(call?.duration || call?.sourceMetadata?.billsec || call?.sourceMetadata?.duration || 0)
      if (Number.isFinite(fallbackSeconds) && fallbackSeconds > 0) {
        seedAudioDurationIfMissing(audioId, fallbackSeconds)
      }
    }
  }

  const handleManualSync = () => {
    setSyncMessage(null)
    syncMutation.mutate(undefined, {
      onSuccess: () => {
        setSyncMessage('Refreshing calls...')
        refetch()
      },
      onError: (error: any) => {
        const msg = error?.response?.data?.message || 'Failed to refresh calls.'
        setSyncMessage(msg)
      },
      onSettled: () => {
        setTimeout(() => setSyncMessage(null), 4000)
      },
    })
  }

  const handleSelectAll = () => {
    if (selectedCalls.size === filteredCalls.length && filteredCalls.length > 0) {
      setSelectedCalls(new Set())
    } else {
      setSelectedCalls(new Set(filteredCalls.map((call: Call) => call.id)))
    }
  }

  const handleSelectCall = (callId: string) => {
    setSelectedCalls((prev) => {
      const next = new Set(prev)
      if (next.has(callId)) {
        next.delete(callId)
      } else {
        next.add(callId)
      }
      return next
    })
  }

  const handleSelectAllCalls = async () => {
    setIsSelectingAll(true)
    try {
      // Fetch all call IDs using the new dedicated endpoint
      const params: any = {}
      if (selectedUserId) params.userId = selectedUserId
      if (dateRange.start) params.startDate = dateRange.start
      if (dateRange.end) params.endDate = dateRange.end
      if (filters.direction) params.direction = filters.direction
      if (filters.booking) params.booking = filters.booking
      if (filters.sentiment) params.sentiment = filters.sentiment
      if (filters.notAnswered) params.notAnswered = true
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      
      const { data } = await apiClient.get('/api/v1/cdr-calls/ids', { params })
      
      setSelectedCalls(new Set(data.callIds))
      setSyncMessage(`Selected all ${data.total} calls`)
      setTimeout(() => setSyncMessage(null), 3000)
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Failed to load all calls.'
      setSyncMessage(msg)
      setTimeout(() => setSyncMessage(null), 4000)
    } finally {
      setIsSelectingAll(false)
    }
  }

  const handleBulkDelete = () => {
    setShowDeleteConfirm(true)
  }

  const confirmBulkDelete = () => {
    const callIds = Array.from(selectedCalls)
    bulkDeleteMutation.mutate(callIds, {
      onSuccess: () => {
        setSyncMessage(`Successfully deleted ${callIds.length} call${callIds.length > 1 ? 's' : ''}`)
        setSelectedCalls(new Set())
        setShowDeleteConfirm(false)
        refetch()
      },
      onError: (error: any) => {
        const msg = error?.response?.data?.message || 'Failed to delete calls.'
        setSyncMessage(msg)
      },
      onSettled: () => {
        setTimeout(() => setSyncMessage(null), 4000)
      },
    })
  }

  const cancelBulkDelete = () => {
    setShowDeleteConfirm(false)
  }

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    setSelectedCalls(new Set()) // Clear selection when changing pages
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const formatActionItems = (actionItemsText: string | undefined | null): string[] => {
    if (!actionItemsText) return []
    const lines = actionItemsText.split('\n').filter(line => line.trim())
    return lines.map((line: string) => {
      const cleanLine = line.replace(/^[-*•]\s*/, '').trim()
      return cleanLine
    })
  }

  const toggleAudio = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return

    Object.entries(audioRefs.current).forEach(([id, element]) => {
      if (id !== audioId && element && !element.paused) {
        element.pause()
        element.currentTime = 0
      }
    })

    if (audio.paused) {
      audio.play()
      setPlayingAudio(audioId)
    } else {
      audio.pause()
      setPlayingAudio(null)
    }
  }

  const handleAudioEnded = (audioId: string) => {
    if (playingAudio === audioId) {
      setPlayingAudio(null)
    }
    setAudioTimes(prev => ({
      ...prev,
      [audioId]: {
        current: 0,
        duration: prev[audioId]?.duration || audioRefs.current[audioId]?.duration || 0,
      },
    }))
  }

  const handleTimeUpdate = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return
    setAudioTimes(prev => {
      const prevDuration = prev[audioId]?.duration || 0
      const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : prevDuration
      return {
        ...prev,
        [audioId]: {
          current: audio.currentTime,
          duration: nextDuration,
        },
      }
    })
  }

  const handleLoadedMetadata = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return
    const duration = audio.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      return
    }
    loadedMetadataRef.current[audioId] = true
    setAudioTimes(prev => {
      const prevEntry = prev[audioId]
      if (prevEntry && prevEntry.duration === duration) {
        return prev
      }
      return {
        ...prev,
        [audioId]: {
          current: prevEntry?.current || 0,
          duration,
        },
      }
    })
  }

  const handleSeek = (audioId: string, value: number) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return
    audio.currentTime = value
    setAudioTimes(prev => ({
      ...prev,
      [audioId]: {
        ...prev[audioId],
        current: value,
        duration: prev[audioId]?.duration || audio.duration || 0,
      },
    }))
  }

  const handleDurationChange = (audioId: string) => {
    const audio = audioRefs.current[audioId]
    if (!audio) return
    const duration = audio.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      return
    }
    setAudioTimes(prev => {
      const prevEntry = prev[audioId]
      if (prevEntry && prevEntry.duration === duration) {
        return prev
      }
      return {
        ...prev,
        [audioId]: {
          current: prevEntry?.current || 0,
          duration,
        },
      }
    })
  }

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const activeFilterCount =
    (filters.direction ? 1 : 0) +
    (filters.booking ? 1 : 0) +
    (filters.sentiment ? 1 : 0) +
    (filters.notAnswered ? 1 : 0)

  const clearAllFilters = () => {
    setFilters({
      direction: null,
      booking: null,
      sentiment: null,
      notAnswered: false,
    })
  }

  const directionLabel = (() => {
    const includeInbound = selectedUser?.freepbxSettings?.call_history_include_inbound !== false
    const includeOutbound = selectedUser?.freepbxSettings?.call_history_include_outbound !== false
    const includeInternal = selectedUser?.freepbxSettings?.call_history_include_internal !== false
    const parts: string[] = []
    if (includeInbound) parts.push('Inbound')
    if (includeOutbound) parts.push('Outbound')
    if (includeInternal) parts.push('Internal')
    return parts.length > 0 ? parts.join('/') : 'None'
  })()

  const formatSentimentLabel = (value: SentimentFilter) => {
    if (!value) return ''
    if (value === 'unknown') return 'Unknown'
    return value.charAt(0).toUpperCase() + value.slice(1)
  }

  return (
    <DashboardLayout>
      <div className="app-container">
        <div className="header">
          <div className="header-content">
            <h1 className="header-title">Calls</h1>
            <p className="header-subtitle">
              {pagination.total} calls • Currently showing {directionLabel}
            </p>
          </div>
          <div className="search-and-sync-row">
            <div className="search-wrapper">
              <div className={`search-container ${searchFocused ? 'focused' : ''}`}>
                <svg className="search-icon" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search calls..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
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

            <div className="filter-wrapper" ref={filterRef}>
              <button
                type="button"
                className={`filter-btn ${isFilterOpen ? 'open' : ''}`}
                onClick={() => setIsFilterOpen((prev) => !prev)}
                aria-label="Add filters"
              >
                Add Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </button>
              {activeFilterCount > 0 && (
                <button type="button" className="filter-clear-link" onClick={clearAllFilters}>
                  Clear
                </button>
              )}

              {isFilterOpen && (
                <div className="filter-popover">
                  <div className="filter-section">
                    <div className="filter-title">Direction</div>
                    <div className="filter-options">
                      <button
                        type="button"
                        className={`status-badge status-neutral filter-badge ${filters.direction === 'inbound' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, direction: p.direction === 'inbound' ? null : 'inbound' }))
                        }
                      >
                        Inbound
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-neutral filter-badge ${filters.direction === 'outbound' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, direction: p.direction === 'outbound' ? null : 'outbound' }))
                        }
                      >
                        Outbound
                      </button>
                    </div>
                  </div>

                  <div className="filter-section">
                    <div className="filter-title">Booking</div>
                    <div className="filter-options">
                      <button
                        type="button"
                        className={`status-badge status-booked filter-badge ${filters.booking === 'Booked' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, booking: p.booking === 'Booked' ? null : 'Booked' }))
                        }
                      >
                        Booked
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-neutral filter-badge ${filters.booking === 'Not Booked' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, booking: p.booking === 'Not Booked' ? null : 'Not Booked' }))
                        }
                      >
                        Not Booked
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-warning filter-badge ${filters.booking === 'Rescheduled' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, booking: p.booking === 'Rescheduled' ? null : 'Rescheduled' }))
                        }
                      >
                        Rescheduled
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-negative filter-badge ${filters.booking === 'Canceled' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, booking: p.booking === 'Canceled' ? null : 'Canceled' }))
                        }
                      >
                        Canceled
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-neutral filter-badge ${filters.booking === 'unknown' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, booking: p.booking === 'unknown' ? null : 'unknown' }))
                        }
                      >
                        Unknown
                      </button>
                    </div>
                  </div>

                  <div className="filter-section">
                    <div className="filter-title">Sentiment</div>
                    <div className="filter-options">
                      <button
                        type="button"
                        className={`status-badge status-positive filter-badge ${filters.sentiment === 'positive' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, sentiment: p.sentiment === 'positive' ? null : 'positive' }))
                        }
                      >
                        Positive
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-neutral filter-badge ${filters.sentiment === 'neutral' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, sentiment: p.sentiment === 'neutral' ? null : 'neutral' }))
                        }
                      >
                        Neutral
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-negative filter-badge ${filters.sentiment === 'negative' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, sentiment: p.sentiment === 'negative' ? null : 'negative' }))
                        }
                      >
                        Negative
                      </button>
                      <button
                        type="button"
                        className={`status-badge status-neutral filter-badge ${filters.sentiment === 'unknown' ? 'selected' : ''}`}
                        onClick={() =>
                          setFilters((p) => ({ ...p, sentiment: p.sentiment === 'unknown' ? null : 'unknown' }))
                        }
                      >
                        Unknown
                      </button>
                    </div>
                  </div>

                  <div className="filter-section">
                    <div className="filter-title">No Answer</div>
                    <div className="filter-options">
                      <button
                        type="button"
                        className={`status-badge status-negative filter-badge ${filters.notAnswered ? 'selected' : ''}`}
                        onClick={() => setFilters((p) => ({ ...p, notAnswered: !p.notAnswered }))}
                      >
                        No Answer
                      </button>
                    </div>
                  </div>

                  <div className="filter-actions">
                    <button type="button" className="btn-ghost" onClick={clearAllFilters} disabled={!activeFilterCount}>
                      Clear all
                    </button>
                    <button type="button" className="btn-apply" onClick={() => setIsFilterOpen(false)}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="sync-controls">
              <div className="sync-info">
                <span className="sync-status-text">
                  {isStatusLoading
                    ? 'Checking status...'
                    : cdrStatus?.lastRun?.at
                      ? `Last sync: ${new Date(cdrStatus.lastRun.at).toLocaleString()}`
                      : 'No syncs yet'}
                </span>
              </div>
              <div className="action-buttons">
                {selectedCalls.size > 0 && (
                  <>
                    <button
                      type="button"
                      className="select-all-btn"
                      onClick={handleSelectAllCalls}
                      disabled={isSelectingAll || bulkDeleteMutation.isPending}
                    >
                      {isSelectingAll ? 'Loading...' : 'Select All'}
                    </button>
                    <button
                      type="button"
                      className="delete-btn"
                      onClick={handleBulkDelete}
                      disabled={bulkDeleteMutation.isPending}
                    >
                      {bulkDeleteMutation.isPending 
                        ? 'Deleting...' 
                        : `Delete Selected (${selectedCalls.size})`}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="sync-btn"
                  onClick={handleManualSync}
                  disabled={syncMutation.isPending}
                >
                  {syncMutation.isPending ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="active-filters-row">
              <div className="active-filters">
                {filters.direction && (
                  <button
                    type="button"
                    className="filter-chip"
                    onClick={() => setFilters((p) => ({ ...p, direction: null }))}
                    aria-label="Remove direction filter"
                  >
                    Direction: {filters.direction === 'inbound' ? 'Inbound' : filters.direction === 'outbound' ? 'Outbound' : ''}
                    <span className="chip-x">×</span>
                  </button>
                )}
                {filters.booking && (
                  <button
                    type="button"
                    className="filter-chip"
                    onClick={() => setFilters((p) => ({ ...p, booking: null }))}
                    aria-label="Remove booking filter"
                  >
                    Booking: {filters.booking === 'unknown' ? 'Unknown' : filters.booking}
                    <span className="chip-x">×</span>
                  </button>
                )}
                {filters.sentiment && (
                  <button
                    type="button"
                    className="filter-chip"
                    onClick={() => setFilters((p) => ({ ...p, sentiment: null }))}
                    aria-label="Remove sentiment filter"
                  >
                    Sentiment: {formatSentimentLabel(filters.sentiment)}
                    <span className="chip-x">×</span>
                  </button>
                )}
                {filters.notAnswered && (
                  <button
                    type="button"
                    className="filter-chip"
                    onClick={() => setFilters((p) => ({ ...p, notAnswered: false }))}
                    aria-label="Remove not answered filter"
                  >
                    No Answer
                    <span className="chip-x">×</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {syncMessage && (
            <div className="sync-message">
              {syncMessage}
            </div>
          )}
        </div>

        {filteredCalls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📞</div>
            <div className="empty-state-text">
              {searchQuery ? 'No calls match your search' : 'No calls available. Configure MySQL CDR access in Settings.'}
            </div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="header-cell cell-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedCalls.size === filteredCalls.length && filteredCalls.length > 0}
                      onChange={handleSelectAll}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                  <th className="header-cell cell-expand"></th>
                  <th className="header-cell cell-date">Date & Time</th>
                  <th className="header-cell cell-caller">Caller</th>
                  <th className="header-cell cell-caller">Callee</th>
                  <th className="header-cell cell-summary">Summary</th>
                  <th className="header-cell cell-sentiment">Sentiment</th>
                  <th className="header-cell cell-urgent">Urgent Topics</th>
                  <th className="header-cell cell-booking">Booking</th>
                  <th className="header-cell cell-direction">Direction</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call: any, index: number) => {
                  const rowId = `row-${index}`
                  const isExpanded = expandedRows.has(rowId)
                  const parsed = parseAnalysis(call.analysis)
                  const sentimentBadge = getSentimentBadge(parsed.sentiment)
                  const hasUrgent = parsed.urgentTopics && parsed.urgentTopics.toLowerCase() !== 'none'
                  const bookingValue = (parsed.booking || '').trim()
                  const bookingBadgeClass =
                    bookingValue === 'Booked'
                      ? 'status-booked'
                      : bookingValue === 'Not Booked'
                        ? 'status-neutral'
                        : bookingValue === 'Rescheduled'
                          ? 'status-warning'
                          : bookingValue === 'Canceled'
                            ? 'status-negative'
                            : ''
                  const detailAudioId = `${call.id}-detail`

                  const rawTimestamp = call.externalCreatedAt || call.createdAt;
                  const userTz = user?.timezone || 'America/New_York';
                  
                  const formatDate = formatDateInTimezone(
                    rawTimestamp,
                    userTz,
                    {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZoneName: 'short'
                    }
                  )

                  const rawDst = String(call.sourceMetadata?.dst ?? '').trim()
                  const dstChannel = String(call.sourceMetadata?.dstchannel ?? '')
                  const parsedAnsweredExtFromChannel = (() => {
                    const m = dstChannel.match(/(?:PJSIP|SIP)\/(\d{3,4})(?:-|$)/i)
                    return m?.[1] ? String(m[1]).trim() : ''
                  })()

                  const answeredExtension =
                    String(call.sourceMetadata?.answered_extension || '').trim() || parsedAnsweredExtFromChannel
                  const answeredName = String(call.sourceMetadata?.answered_name || '').trim()

                  const calleeName = answeredName || call.sourceMetadata?.dst_cnam || null
                  const calleeNumber = rawDst === '0' && answeredExtension ? answeredExtension : rawDst || 'Unknown'
                  const dispositionRaw = String(call.sourceMetadata?.disposition || '').trim()
                  const dispositionLabel = dispositionRaw
                    ? dispositionRaw
                        .replace(/_/g, ' ')
                        .replace(/\s+/g, ' ')
                        .toLowerCase()
                        .replace(/\b\w/g, (m: string) => m.toUpperCase())
                    : ''
                  const dispositionUpper = dispositionRaw.toUpperCase().trim()
                  const showNoAnswerBadge =
                    call.source === 'freepbx-cdr' && dispositionUpper && dispositionUpper !== 'ANSWERED'
                  const directionLabel =
                    call.direction === 'inbound'
                      ? 'Inbound'
                      : call.direction === 'outbound'
                        ? 'Outbound'
                        : call.direction === 'internal'
                          ? 'Internal'
                          : ''

                  return (
                    <>
                      <tr
                        key={call.id}
                        className={`data-row ${index % 2 === 1 ? 'striped' : ''} ${isExpanded ? 'expanded' : ''} ${selectedCalls.has(call.id) ? 'selected' : ''}`}
                        data-row-id={rowId}
                        onClick={() => toggleRow(rowId, call, detailAudioId)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="cell-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedCalls.has(call.id)}
                            onChange={() => handleSelectCall(call.id)}
                          />
                        </td>
                        <td className="cell-expand">
                          <button
                            className="expand-row-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleRow(rowId, call, detailAudioId)
                            }}
                            aria-label="Expand row"
                          >
                            <svg
                              className="expand-icon"
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            >
                              <path d="M6 4l4 4-4 4"/>
                            </svg>
                          </button>
                        </td>
                        <td className="cell-date">
                          <div className="cell-content">{formatDate}</div>
                        </td>
                        <td className="cell-caller">
                          <div className="caller-info">
                            {call.callerName && <div className="caller-name">{call.callerName}</div>}
                            <div className="caller-number">{call.callerNumber || 'Unknown'}</div>
                          </div>
                        </td>
                        <td className="cell-caller">
                          <div className="caller-info">
                            {calleeName && <div className="caller-name">{calleeName}</div>}
                            <div className="caller-number">{calleeNumber}</div>
                          </div>
                        </td>
                        <td className="cell-summary">
                          <div className="cell-content">
                            {showNoAnswerBadge ? (
                              <span className="status-badge status-negative">{dispositionLabel}</span>
                            ) : (
                              createPreview(parsed.summary, 80)
                            )}
                          </div>
                        </td>
                        <td className="cell-sentiment">
                          <div className="cell-content">
                            <span className={`status-badge ${sentimentBadge.class}`}>{sentimentBadge.text}</span>
                          </div>
                        </td>
                        <td className="cell-urgent">
                          <div className="cell-content">{createPreview(hasUrgent ? parsed.urgentTopics : 'None', 50)}</div>
                        </td>
                        <td className="cell-booking">
                          <div className="cell-content">
                            {bookingValue ? <span className={`status-badge ${bookingBadgeClass}`}>{bookingValue}</span> : ''}
                          </div>
                        </td>
                        <td className="cell-direction">
                          <div className="cell-content">{directionLabel}</div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="expanded-row" data-expanded-for={rowId}>
                          <td colSpan={10} className="expanded-content-cell">
                            <div className="expanded-details">
                              <div className="expanded-left">
                                <div className="detail-section summary-section">
                                  <div className="detail-label">Summary</div>
                                  <div className="detail-value">
                                    {parsed.summary || 'No summary available'}
                                  </div>
                                </div>
                                <div className="detail-section action-section">
                                  <div className="detail-label">Action Items</div>
                                  <div className="detail-value">
                                    {formatActionItems(parsed.actionItems).length > 0 ? (
                                      formatActionItems(parsed.actionItems).map((item: string, idx: number) => (
                                        <div key={idx} className="action-item">{item}</div>
                                      ))
                                    ) : (
                                      <div className="action-item">No action items</div>
                                    )}
                                  </div>
                                </div>
                                <div className={`detail-section urgent-section ${hasUrgent ? 'urgent-detail' : ''}`}>
                                  <div className="detail-label">Urgent Topics</div>
                                  <div className={`detail-value ${hasUrgent ? 'urgent-text' : ''}`}>
                                    {hasUrgent ? parsed.urgentTopics : 'None'}
                                  </div>
                                </div>
                                <div className="detail-section listen-section">
                                  <div className="detail-label">Listen</div>
                                  {call.recordingPath && dispositionUpper === 'ANSWERED' ? (
                                    <div className="detail-value">
                                      <div className="audio-player-container">
                                        <button
                                          type="button"
                                          className={`audio-play-btn detail-audio-btn ${playingAudio === detailAudioId ? 'playing' : ''}`}
                                          onClick={() => toggleAudio(detailAudioId)}
                                          aria-label="Play audio"
                                        >
                                          {playingAudio === detailAudioId ? (
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                            </svg>
                                          ) : (
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                              <path d="M8 5v14l11-7z" />
                                            </svg>
                                          )}
                                        </button>
                                        <div className="audio-controls">
                                          <div className="audio-time-display">
                                            <span className="time-current">
                                              {(() => {
                                                const current = audioTimes[detailAudioId]?.current || 0;
                                                if (!Number.isFinite(current) || current < 0) return '0:00';
                                                const mins = Math.floor(current / 60);
                                                const secs = Math.floor(current % 60);
                                                return `${mins}:${secs.toString().padStart(2, '0')}`;
                                              })()}
                                            </span>
                                            <span className="time-separator">/</span>
                                            <span className="time-duration">
                                              {(() => {
                                                const duration = audioTimes[detailAudioId]?.duration || 0;
                                                if (!Number.isFinite(duration) || duration <= 0) return '--:--';
                                                const mins = Math.floor(duration / 60);
                                                const secs = Math.floor(duration % 60);
                                                return `${mins}:${secs.toString().padStart(2, '0')}`;
                                              })()}
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            className="audio-seek-bar"
                                            min="0"
                                            max={audioTimes[detailAudioId]?.duration || 100}
                                            value={audioTimes[detailAudioId]?.current || 0}
                                            onChange={(e) => handleSeek(detailAudioId, parseFloat(e.target.value))}
                                            step="0.1"
                                            disabled={
                                              playingAudio !== detailAudioId ||
                                              !audioTimes[detailAudioId]?.duration ||
                                              audioTimes[detailAudioId]?.duration <= 0
                                            }
                                          />
                                        </div>
                                      </div>
                                      <audio
                                        ref={(el) => {
                                          if (el) {
                                            audioRefs.current[detailAudioId] = el
                                            if (el.readyState >= 1 && !loadedMetadataRef.current[detailAudioId]) {
                                              handleLoadedMetadata(detailAudioId)
                                            }
                                          } else {
                                            delete audioRefs.current[detailAudioId]
                                            delete loadedMetadataRef.current[detailAudioId]
                                          }
                                        }}
                                        preload="none"
                                        onEnded={() => handleAudioEnded(detailAudioId)}
                                        onTimeUpdate={() => handleTimeUpdate(detailAudioId)}
                                        onLoadedMetadata={() => handleLoadedMetadata(detailAudioId)}
                                        onDurationChange={() => handleDurationChange(detailAudioId)}
                                      >
                                        <source src={`/api/audio/${call.id}`} type="audio/wav" />
                                      </audio>
                                    </div>
                                  ) : (
                                    <div className="detail-value no-audio">
                                      {call.recordingDeletedAt || call.recordingDeletedReason === 'retention'
                                        ? 'Recording auto deleted (retention policy)'
                                        : 'No recording available for this call'}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="detail-section transcript-section">
                                <div className="detail-label">Full Transcript</div>
                                <div className="detail-value transcript-text">
                                  {call.transcript || 'No transcript available'}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>

            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  ← Previous
                </button>
                <span className="pagination-info">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} total calls)
                </span>
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= pagination.totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
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
          margin-bottom: 32px;
        }

        .search-and-sync-row {
          display: grid;
          grid-template-columns: 160px 320px 140px 1fr;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
        }

        .sync-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
          justify-self: end;
          justify-content: flex-end;
        }

        .sync-info {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          text-align: right;
        }

        .sync-status-text {
          font-size: 12px;
          color: #787774;
          white-space: nowrap;
        }

        .sync-btn {
          border: 1px solid #d7d5d1;
          background: #ffffff;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          color: #37352f;
          min-width: 100px;
          transition: all 0.15s ease;
        }

        .sync-btn:hover:not(:disabled) {
          background: #f7f6f3;
          border-color: #bab8b4;
        }

        .sync-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sync-message {
          margin-top: 8px;
          font-size: 12px;
          color: #37352f;
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
          width: 160px;
          max-width: 160px;
          min-width: 160px;
        }
        
        .date-filter {
          position: relative;
          min-width: 320px;
          max-width: 320px;
          width: 100%;
          justify-self: flex-start;
        }

        .filter-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .filter-btn {
          width: auto;
          height: 40px;
          border: 1px solid #e9e9e7;
          background: #ffffff;
          border-radius: 6px;
          padding: 0 12px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          color: #37352f;
          transition: border-color 0.18s ease, background 0.18s ease;
          text-align: left;
          white-space: nowrap;
        }

        .filter-clear-link {
          border: none;
          background: transparent;
          padding: 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--app-accent);
          cursor: pointer;
          white-space: nowrap;
        }

        .filter-clear-link:hover {
          color: var(--app-accent-hover);
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .filter-btn:hover,
        .filter-btn.open {
          border-color: #d1d1cf;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
          background: #fcfcfb;
        }

        .filter-popover {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          width: 380px;
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 8px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
          padding: 14px;
          z-index: 110;
        }

        .filter-section {
          padding: 10px 0;
          border-bottom: 1px solid #f1f1ee;
        }

        .filter-section:last-child {
          border-bottom: none;
        }

        .filter-title {
          font-size: 12px;
          font-weight: 600;
          color: #2f2f2f;
          margin-bottom: 8px;
        }

        .filter-options {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .filter-badge {
          cursor: pointer;
          padding: 6px 10px;
          border-radius: 999px;
          line-height: 1.6;
          transition: box-shadow 0.16s ease, transform 0.04s ease;
        }

        .filter-badge:active {
          transform: translateY(0.5px);
        }

        .filter-badge.selected {
          box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.22);
        }

        .filter-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding-top: 12px;
        }

        .active-filters-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 10px;
        }

        .active-filters {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .filter-chip {
          border: 1px solid #e9e9e7;
          background: #ffffff;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          color: #37352f;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: all 0.16s ease;
        }

        .filter-chip:hover {
          border-color: #d1d1cf;
          background: #f7f6f3;
        }

        .chip-x {
          font-size: 14px;
          line-height: 1;
          color: #9b9a97;
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

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
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
        
        .search-container {
          display: flex;
          align-items: center;
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 0 12px;
          transition: all 0.15s ease;
          position: relative;
          height: 40px;
        }
        
        .search-container:hover {
          background: #ffffff;
          border-color: #d1d1cf;
        }
        
        .search-container.focused {
          background: #ffffff;
          border-color: #bab8b4;
          box-shadow: none;
        }
        
        .search-icon {
          width: 18px;
          height: 18px;
          color: #787774;
          margin-right: 10px;
          flex-shrink: 0;
          fill: currentColor;
        }
        
        .search-container.focused .search-icon {
          color: #6b6b69;
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

        @media (max-width: 768px) {
          .search-and-sync-row {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .search-wrapper,
          .date-filter,
          .filter-wrapper {
            width: 100%;
            max-width: 100%;
            min-width: 0;
          }

          .date-filter-popover {
            width: 100%;
            right: auto;
            left: 0;
          }

          .filter-popover {
            width: 100%;
          }

          .sync-controls {
            width: 100%;
            justify-content: space-between;
          }

          .sync-btn {
            width: auto;
            min-width: 120px;
          }
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

        .data-row.striped td {
          background: #fafaf7;
        }
        
        .data-table tbody tr.data-row:hover {
          background: #f7f6f3;
        }
        
        .data-table tbody tr.data-row:hover td {
          background: #f7f6f3;
        }
        
        .data-table tbody tr.expanded-row td {
          border-bottom: 1px solid #e9e9e7;
          background: #fafafa;
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
        
        .cell-expand {
          width: 48px;
          min-width: 48px;
          padding-left: 12px !important;
          padding-right: 12px !important;
          text-align: center;
        }

        .cell-checkbox {
          width: 48px;
          min-width: 48px;
          padding-left: 12px !important;
          padding-right: 12px !important;
          text-align: center;
        }

        .cell-checkbox input[type="checkbox"] {
          cursor: pointer;
          width: 16px;
          height: 16px;
        }

        .data-row.selected {
          background-color: #f3f4f6;
        }

        .data-row.selected:hover {
          background-color: #e5e7eb;
        }

        .data-row.selected td {
          background-color: #f3f4f6;
        }

        .data-row.selected:hover td {
          background-color: #e5e7eb;
        }

        .action-buttons {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .select-all-btn {
          padding: 6px 12px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .select-all-btn:hover:not(:disabled) {
          background: #2563eb;
        }

        .select-all-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .delete-btn {
          padding: 6px 12px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .delete-btn:hover:not(:disabled) {
          background: #dc2626;
        }

        .delete-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .expand-row-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #9b9a97;
          transition: all 0.15s ease;
          width: 28px;
          height: 28px;
        }
        
        .expand-row-btn:hover {
          background: none;
          color: #37352f;
        }
        
        .expand-icon {
          transition: transform 0.2s ease;
          width: 14px;
          height: 14px;
        }
        
        .cell-content {
          color: #37352f;
          font-size: 12px;
          line-height: 1.5;
          word-wrap: break-word;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        
        .cell-caller {
          width: 180px;
          min-width: 180px;
          max-width: 200px;
        }
        
        .caller-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .caller-name {
          font-size: 12px;
          font-weight: normal;
          color: #37352f;
          line-height: 1.4;
        }
        
        .caller-number {
          font-size: 12px;
          color: #37352f;
          line-height: 1.4;
        }

        .caller-source {
          margin-top: 4px;
        }

        .source-badge {
          display: inline-flex;
          align-items: center;
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .source-freepbx-cdr {
          background: rgba(156, 39, 176, 0.15);
          color: #8e24aa;
        }
        
        .cell-date {
          width: 180px;
          min-width: 180px;
          max-width: 180px;
        }
        
        .cell-summary {
          min-width: 280px;
          max-width: 400px;
        }
        
        .cell-sentiment {
          width: 110px;
          min-width: 110px;
          max-width: 110px;
        }
        
        .cell-urgent {
          min-width: 180px;
          max-width: 280px;
        }

        .cell-booking {
          width: 130px;
          min-width: 130px;
          max-width: 130px;
        }

        .cell-direction {
          width: 120px;
          min-width: 120px;
          max-width: 120px;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0;
          white-space: nowrap;
          line-height: 1.4;
          border: none;
        }
        
        .status-badge.status-positive {
          background-color: rgba(46, 170, 220, 0.12);
          color: #0b6e99;
        }
        
        .status-badge.status-negative {
          background-color: rgba(235, 87, 87, 0.12);
          color: #d1242f;
        }
        
        .status-badge.status-neutral {
          background-color: rgba(55, 53, 47, 0.09);
          color: #37352f;
        }

        .status-badge.status-booked {
          background-color: var(--app-accent-soft-bg);
          color: var(--app-accent-hover);
        }

        .status-badge.status-warning {
          background-color: rgba(245, 158, 11, 0.16);
          color: #b45309;
        }

        .expanded-content-cell {
          padding: 20px 24px !important;
          background: #fafafa;
          border-bottom: 1px solid #e9e9e7 !important;
        }
        
        .expanded-details {
          display: grid;
          align-items: stretch;
          gap: 16px;
          max-width: 1200px;
          grid-template-columns: 2fr 1fr;
        }

        .expanded-left {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr auto;
          gap: 16px;
          align-items: stretch;
          height: 100%;
          min-height: 0;
        }

        .expanded-left .detail-section.summary-section {
          grid-column: 1;
          grid-row: 1;
        }

        .expanded-left .detail-section.action-section {
          grid-column: 2;
          grid-row: 1;
        }

        .expanded-left .detail-section.urgent-section {
          grid-column: 1;
          grid-row: 2;
        }

        .expanded-left .detail-section.listen-section {
          grid-column: 2;
          grid-row: 2;
        }
        
        .detail-section {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 16px 20px;
        }

        .detail-section.transcript-section {
          min-height: 0;
        }

        
        .detail-section.urgent-detail {
          border-left: 4px solid #e16259;
          background: #fff5f3;
        }
        
        .detail-label {
          font-size: 11px;
          font-weight: 600;
          color: #787774;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 10px;
          display: block;
        }
        
        .detail-value {
          font-size: 12px;
          color: #37352f;
          line-height: 1.65;
        }

        .urgent-text {
          color: #e16259;
          font-weight: 500;
        }

        .transcript-text {
          max-height: 350px;
          overflow-y: auto;
          font-size: 12px;
          color: #37352f;
          line-height: 1.65;
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        .action-item {
          padding: 10px 0;
          border-bottom: 1px solid #f1f1ef;
          line-height: 1.6;
          display: flex;
          align-items: flex-start;
          font-size: 12px;
        }
        
        .action-item:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        
        .action-item:first-child {
          padding-top: 0;
        }
        
        .action-item::before {
          content: "→";
          color: #787774;
          font-weight: normal;
          margin-right: 10px;
          font-size: 12px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .audio-player-container {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }

        .audio-play-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid var(--app-accent);
          background: var(--app-accent);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
          padding: 0;
          outline: none;
          color: #ffffff;
        }

        .audio-play-btn:hover {
          background: var(--app-accent-hover);
          border-color: var(--app-accent-hover);
        }

        .audio-play-btn:active {
          transform: scale(0.95);
        }

        .audio-play-btn.playing {
          background: var(--app-accent-hover);
          border-color: var(--app-accent-hover);
        }

        .audio-play-btn svg {
          width: 14px;
          height: 14px;
        }

        .detail-audio-btn {
          width: 32px;
          height: 32px;
        }

        .detail-audio-btn svg {
          width: 14px;
          height: 14px;
        }

        .audio-controls {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }

        .audio-time-display {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--app-accent);
          font-variant-numeric: tabular-nums;
          min-width: 85px;
        }

        .time-current {
          color: var(--app-accent);
          font-weight: 500;
        }

        .time-separator {
          color: var(--app-accent);
        }

        .time-duration {
          color: var(--app-accent);
        }

        .audio-seek-bar {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: #e9e9e7;
          outline: none;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .audio-seek-bar:hover {
          background: #d1d1cf;
        }

        .audio-seek-bar::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--app-accent);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .audio-seek-bar::-webkit-slider-thumb:hover {
          background: var(--app-accent-hover);
          transform: scale(1.2);
        }

        .audio-seek-bar::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--app-accent);
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .audio-seek-bar::-moz-range-thumb:hover {
          background: var(--app-accent-hover);
          transform: scale(1.2);
        }

        .no-audio {
          color: #9b9a97;
          font-size: 12px;
          font-style: italic;
        }

        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 20px;
          border-top: 1px solid #e9e9e7;
        }

        .pagination-btn {
          padding: 8px 16px;
          border: 1px solid #d7d5d1;
          background: #ffffff;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          color: #37352f;
          transition: all 0.2s;
        }

        .pagination-btn:hover:not(:disabled) {
          background: #f7f6f3;
          border-color: #4285f4;
        }

        .pagination-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .pagination-info {
          font-size: 13px;
          color: #787774;
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

        @media (max-width: 768px) {
          .search-and-sync-row {
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
          }

          .search-wrapper {
            max-width: 100%;
          }

          .sync-controls {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }

          .sync-info {
            justify-content: center;
          }

          .sync-btn {
            width: 100%;
          }
        }
      `}</style>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={cancelBulkDelete}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Deletion</h3>
            <p>
              Are you sure you want to delete {selectedCalls.size} call{selectedCalls.size > 1 ? 's' : ''}? 
              This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="modal-btn cancel-btn" onClick={cancelBulkDelete}>
                Cancel
              </button>
              <button 
                className="modal-btn delete-btn" 
                onClick={confirmBulkDelete}
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: white;
          padding: 24px;
          border-radius: 8px;
          max-width: 400px;
          width: 90%;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .modal-content h3 {
          margin: 0 0 16px 0;
          font-size: 20px;
          font-weight: 600;
          color: #111827;
        }

        .modal-content p {
          margin: 0 0 24px 0;
          color: #6b7280;
          line-height: 1.5;
        }

        .modal-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }

        .modal-btn {
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .cancel-btn {
          background: #f3f4f6;
          color: #374151;
        }

        .cancel-btn:hover {
          background: #e5e7eb;
        }

        .modal-btn.delete-btn {
          background: #ef4444;
          color: white;
        }

        .modal-btn.delete-btn:hover:not(:disabled) {
          background: #dc2626;
        }

        .modal-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </DashboardLayout>
  )
}

