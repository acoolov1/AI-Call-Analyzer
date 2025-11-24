'use client'

import { useState, useEffect, useRef } from 'react'
import { useCalls, useFreepbxStatus, useFreepbxSync, useDeleteCall, useBulkDeleteCalls } from '@/hooks/use-calls'
import { useUser } from '@/hooks/use-user'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { parseAnalysis, getSentimentBadge, createPreview, hasUrgentTopics } from '@/lib/analysis-parser'
import { formatDateInTimezone } from '@/lib/timezone'
import { debugTimezoneConversion } from '@/lib/timezone-debug'

export default function CallsPage() {
  const { data: session, status } = useSession()
  const { data: user } = useUser()
  const { data: calls, isLoading, refetch: refetchCalls } = useCalls({ limit: 100 })
  const { data: freepbxStatus, isLoading: isFreepbxStatusLoading } = useFreepbxStatus()
  const syncMutation = useFreepbxSync()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({})
  const [audioTimes, setAudioTimes] = useState<{ [key: string]: { current: number, duration: number } }>({})
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [selectedCalls, setSelectedCalls] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | string[] | null>(null)
  
  const deleteMutation = useDeleteCall()
  const bulkDeleteMutation = useBulkDeleteCalls()

  const getSourceMetadata = (call: any): Record<string, any> => {
    if (!call?.sourceMetadata) return {}
    if (typeof call.sourceMetadata === 'string') {
      try {
        return JSON.parse(call.sourceMetadata)
      } catch {
        return {}
      }
    }
    return call.sourceMetadata
  }

  const cleanCallerString = (value?: string | null): string | null => {
    if (value === undefined || value === null) return null
    const strValue = typeof value === 'string' ? value : String(value)
    const trimmed = strValue.trim()
    return trimmed.length ? trimmed : null
  }

  const cleanCallerNumber = (value?: string | null): string | null => {
    if (value === undefined || value === null) return null
    const strValue = typeof value === 'string' ? value : String(value)
    const angleMatch = strValue.match(/<([^>]+)>/)
    if (angleMatch?.[1]) {
      return angleMatch[1]
    }
    const digitsOnly = strValue.replace(/[^\d+]/g, '')
    if (digitsOnly.length >= 6 && digitsOnly.length <= 15) {
      return digitsOnly
    }
    const trimmed = strValue.trim()
    return trimmed.length ? trimmed : null
  }

  const extractNumberFromRecordingName = (name?: string | null): string | null => {
    if (!name) return null
    const match = name.match(/(?:out|in|exten)-(\d{6,15})-/i)
    if (match?.[1]) {
      return match[1]
    }
    return null
  }

  const getDisplayCallerName = (call: any): string | null => {
    const metadata = getSourceMetadata(call)
    return cleanCallerString(
      call?.callerName ||
      metadata.caller_name ||
      metadata.calleridname ||
      metadata.callerid_name ||
      metadata.orig_caller_id_name ||
      metadata.origcallername ||
      metadata.cid_name ||
      metadata.callerid
    )
  }

  const getDisplayCallerNumber = (call: any): string | null => {
    const metadata = getSourceMetadata(call)
    return (
      cleanCallerNumber(
        call?.callerNumber ||
        metadata.caller_number ||
        metadata.calleridnum ||
        metadata.callerid ||
        metadata.original_caller_id_number ||
        metadata.orig_caller_id_num ||
        metadata.cid_num ||
        metadata.connectedlinenum
      ) ||
      extractNumberFromRecordingName(call?.recordingPath || metadata.name || call?.recordingSid)
    )
  }

  // Debug user timezone
  useEffect(() => {
    if (user) {
      console.log('👤 User timezone:', user.timezone || 'NOT SET')
      console.log('👤 Full user object:', user)
    }
  }, [user])

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (isLoading) {
    return <div>Loading calls...</div>
  }

  const filteredCalls = calls?.filter(call => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const callerName = getDisplayCallerName(call)?.toLowerCase() || ''
    const callerNumber = getDisplayCallerNumber(call)?.toLowerCase() || ''
    const caller = `${callerName} ${callerNumber}`.trim()
    const transcript = call.transcript?.toLowerCase() || ''
    const analysis = call.analysis?.toLowerCase() || ''
    return caller.includes(query) || transcript.includes(query) || analysis.includes(query)
  }) || []

  const toggleSelectCall = (callId: string) => {
    setSelectedCalls(prev => {
      const next = new Set(prev)
      if (next.has(callId)) {
        next.delete(callId)
      } else {
        next.add(callId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedCalls.size === filteredCalls.length) {
      setSelectedCalls(new Set())
    } else {
      setSelectedCalls(new Set(filteredCalls.map(c => c.id)))
    }
  }

  const handleBulkDeleteClick = () => {
    if (selectedCalls.size === 0) return
    setDeleteTarget(Array.from(selectedCalls))
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return

    try {
      if (Array.isArray(deleteTarget)) {
        await bulkDeleteMutation.mutateAsync(deleteTarget)
        setSelectedCalls(new Set())
      } else {
        await deleteMutation.mutateAsync(deleteTarget)
        setSelectedCalls(prev => {
          const next = new Set(prev)
          next.delete(deleteTarget)
          return next
        })
      }
      // Force refetch to update UI immediately
      await refetchCalls()
    } catch (error) {
      console.error('Delete failed:', error)
    } finally {
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
    }
  }

  const cancelDelete = () => {
    setShowDeleteConfirm(false)
    setDeleteTarget(null)
  }

  const toggleRow = (rowId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  const toggleAudio = (callId: string) => {
    const audio = audioRefs.current[callId]
    if (!audio) return

    // Pause all other audio players
    Object.entries(audioRefs.current).forEach(([id, a]) => {
      if (id !== callId && !a.paused) {
        a.pause()
        a.currentTime = 0
      }
    })

    if (audio.paused) {
      audio.play()
      setPlayingAudio(callId)
    } else {
      audio.pause()
      setPlayingAudio(null)
    }
  }

  const handleAudioEnded = (callId: string) => {
    setPlayingAudio(null)
  }

  const handleTimeUpdate = (callId: string) => {
    const audio = audioRefs.current[callId]
    if (!audio) return
    setAudioTimes(prev => ({
      ...prev,
      [callId]: {
        current: audio.currentTime,
        duration: audio.duration || 0
      }
    }))
  }

  const handleLoadedMetadata = (callId: string) => {
    const audio = audioRefs.current[callId]
    if (!audio) return
    setAudioTimes(prev => ({
      ...prev,
      [callId]: {
        current: 0,
        duration: audio.duration || 0
      }
    }))
  }

  const handleSeek = (callId: string, value: number) => {
    const audio = audioRefs.current[callId]
    if (!audio) return
    audio.currentTime = value
    setAudioTimes(prev => ({
      ...prev,
      [callId]: {
        ...prev[callId],
        current: value
      }
    }))
  }

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatActionItems = (actionItemsText: string | undefined | null): string[] => {
    if (!actionItemsText) return []
    const lines = actionItemsText.split('\n').filter(line => line.trim())
    return lines.map((line: string) => {
      const cleanLine = line.replace(/^[-*•]\s*/, '').trim()
      return cleanLine
    })
  }

  const handleManualSync = () => {
    setSyncMessage(null)
    syncMutation.mutate(undefined, {
      onSuccess: () => {
        setSyncMessage('FreePBX sync started. New calls will appear shortly.')
      },
      onError: (error: any) => {
        const msg = error?.response?.data?.message || 'Failed to start FreePBX sync.'
        setSyncMessage(msg)
      },
      onSettled: () => {
        setTimeout(() => setSyncMessage(null), 4000)
      },
    })
  }

  const renderSourceBadge = (source?: string) => {
    if (!source || source === 'twilio') {
      return <span className="source-badge source-twilio">Twilio</span>
    }
    return <span className="source-badge source-freepbx">FreePBX</span>
  }

  return (
    <DashboardLayout>
      <div className="app-container">
        <div className="header">
          <div className="header-content">
            <h1 className="header-title">Interactions</h1>
            <p className="header-subtitle">View and manage your call interactions • {filteredCalls.length} calls</p>
          </div>
          {freepbxStatus?.freepbxSettings?.enabled && (
            <div className="sync-panel">
              <div className="sync-meta">
                <span className="sync-label">FreePBX</span>
                <span className="sync-value">
                  {isFreepbxStatusLoading
                    ? 'Checking status...'
                    : freepbxStatus?.lastRun?.at
                      ? `Last sync ${new Date(freepbxStatus.lastRun.at).toLocaleString()}`
                      : 'No syncs yet'}
                </span>
              </div>
              <button
                type="button"
                className="sync-btn"
                onClick={handleManualSync}
                disabled={syncMutation.isPending}
              >
                {syncMutation.isPending ? 'Syncing...' : 'Sync FreePBX'}
              </button>
            </div>
          )}
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
          {syncMessage && (
            <div className="sync-message">
              {syncMessage}
            </div>
          )}

          {selectedCalls.size > 0 && (
            <div className="bulk-actions-toolbar">
              <span className="selected-count">{selectedCalls.size} selected</span>
              <button 
                onClick={handleBulkDeleteClick}
                className="btn-delete-bulk"
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete Selected'}
              </button>
              <button 
                onClick={() => setSelectedCalls(new Set())}
                className="btn-cancel"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {filteredCalls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📞</div>
            <div className="empty-state-text">
              {searchQuery ? 'No calls match your search' : 'No calls analyzed yet. Make a call to your Twilio number first.'}
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
                      checked={filteredCalls.length > 0 && selectedCalls.size === filteredCalls.length}
                      onChange={toggleSelectAll}
                      className="checkbox-select-all"
                    />
                  </th>
                  <th className="header-cell cell-expand"></th>
                  <th className="header-cell cell-caller">Caller</th>
                  <th className="header-cell cell-date">Date & Time</th>
                  <th className="header-cell cell-summary">Summary</th>
                  <th className="header-cell cell-sentiment">Sentiment</th>
                  <th className="header-cell cell-actions">Action Items</th>
                  <th className="header-cell cell-urgent">Urgent Topics</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call, index) => {
                  const rowId = `row-${index}`
                  const isExpanded = expandedRows.has(rowId)
                  const parsed = parseAnalysis(call.analysis)
                  const sentimentBadge = getSentimentBadge(parsed.sentiment)
                  const hasUrgent = hasUrgentTopics(parsed.urgentTopics)
                  const displayCallerName = getDisplayCallerName(call)
                  const displayCallerNumber = getDisplayCallerNumber(call)
                  const displayCaller = call.callerName 
                    ? `${call.callerName} ${call.callerNumber}` 
                    : call.callerNumber
                  
                  // Debug first call only
                  if (index === 0 && user?.timezone) {
                    debugTimezoneConversion(call.createdAt, user.timezone)
                  }
                  
                  const formatDate = formatDateInTimezone(
                    call.createdAt,
                    user?.timezone || 'UTC',
                    {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZoneName: 'short'
                    }
                  )

                  return (
                    <>
                      <tr
                        key={call.id}
                        className={`data-row ${isExpanded ? 'expanded' : ''} ${selectedCalls.has(call.id) ? 'selected' : ''}`}
                        data-row-id={rowId}
                        onClick={() => toggleRow(rowId)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="cell-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedCalls.has(call.id)}
                            onChange={() => toggleSelectCall(call.id)}
                            className="checkbox-select"
                          />
                        </td>
                        <td className="cell-expand">
                      <button
                            className="expand-row-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleRow(rowId)
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
                        <td className="cell-caller">
                          <div className="caller-info">
                            {displayCallerName && <div className="caller-name">{displayCallerName}</div>}
                            <div className="caller-number">{displayCallerNumber || 'Unknown number'}</div>
                            <div className="caller-source">
                              {renderSourceBadge(call.source)}
                            </div>
                          </div>
                        </td>
                        <td className="cell-date">
                          <div className="cell-content">{formatDate}</div>
                        </td>
                        <td className="cell-summary">
                          <div className="cell-content">{createPreview(parsed.summary, 80)}</div>
                        </td>
                        <td className="cell-sentiment">
                          <div className="cell-content">
                            <span className={`status-badge ${sentimentBadge.class}`}>{sentimentBadge.text}</span>
                          </div>
                        </td>
                        <td className="cell-actions">
                          <div className="cell-content">{createPreview(parsed.actionItems, 60)}</div>
                        </td>
                        <td className="cell-urgent">
                          <div className="cell-content">{createPreview(hasUrgent ? parsed.urgentTopics : 'None', 50)}</div>
                        </td>
                  </tr>
                      {isExpanded && (
                        <tr className="expanded-row" data-expanded-for={rowId}>
                          <td colSpan={8} className="expanded-content-cell">
                            <div className="expanded-details">
                              <div className="detail-section">
                                <div className="detail-label">Summary</div>
                                <div className="detail-value">
                                  {parsed.summary || 'No summary available'}
                                </div>
                              </div>
                              {parsed.actionItems && (
                                <div className="detail-section">
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
                              )}
                              {parsed.urgentTopics && (
                                <div className={`detail-section ${hasUrgent ? 'urgent-detail' : ''}`}>
                                  <div className="detail-label">Urgent Topics</div>
                                  <div className={`detail-value ${hasUrgent ? 'urgent-text' : ''}`}>
                                    {parsed.urgentTopics}
                                  </div>
                                </div>
                              )}
                              {(call.recordingUrl || call.recordingPath) && (
                                <div className="detail-section">
                                  <div className="detail-label">Listen</div>
                                  <div className="detail-value">
                                    <div className="audio-player-container">
                                      <button
                                        className={`audio-play-btn detail-audio-btn ${playingAudio === `${call.id}-detail` ? 'playing' : ''}`}
                                        onClick={() => toggleAudio(`${call.id}-detail`)}
                                        aria-label="Play audio"
                                      >
                                        {playingAudio === `${call.id}-detail` ? (
                                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                          </svg>
                                        ) : (
                                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M8 5v14l11-7z"/>
                                          </svg>
                                        )}
                                      </button>
                                      <div className="audio-controls">
                                        <div className="audio-time-display">
                                          <span className="time-current">
                                            {formatTime(audioTimes[`${call.id}-detail`]?.current || 0)}
                                          </span>
                                          <span className="time-separator">/</span>
                                          <span className="time-duration">
                                            {formatTime(audioTimes[`${call.id}-detail`]?.duration || 0)}
                                          </span>
                                        </div>
                                        <input
                                          type="range"
                                          className="audio-seek-bar"
                                          min="0"
                                          max={audioTimes[`${call.id}-detail`]?.duration || 0}
                                          value={audioTimes[`${call.id}-detail`]?.current || 0}
                                          onChange={(e) => handleSeek(`${call.id}-detail`, parseFloat(e.target.value))}
                                          step="0.1"
                                        />
                                      </div>
                                    </div>
                                    <audio
                                      ref={(el) => {
                                        if (el) audioRefs.current[`${call.id}-detail`] = el
                                      }}
                                      preload="metadata"
                                      onEnded={() => handleAudioEnded(`${call.id}-detail`)}
                                      onTimeUpdate={() => handleTimeUpdate(`${call.id}-detail`)}
                                      onLoadedMetadata={() => handleLoadedMetadata(`${call.id}-detail`)}
                                    >
                                      <source src={`/api/audio/${call.id}`} type="audio/wav" />
                                    </audio>
                                  </div>
                                </div>
                              )}
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
        </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={cancelDelete}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Confirm Delete</h3>
            <p className="modal-message">
              {Array.isArray(deleteTarget) 
                ? `Are you sure you want to delete ${deleteTarget.length} call(s)? This action cannot be undone.`
                : 'Are you sure you want to delete this call? This action cannot be undone.'
              }
            </p>
            <div className="modal-actions">
              <button onClick={cancelDelete} className="btn-modal-cancel">
                Cancel
              </button>
              <button 
                onClick={confirmDelete} 
                className="btn-modal-delete"
                disabled={deleteMutation.isPending || bulkDeleteMutation.isPending}
              >
                {(deleteMutation.isPending || bulkDeleteMutation.isPending) ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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

        .sync-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 12px 16px;
          margin-bottom: 16px;
          background: #f9f9f7;
          gap: 16px;
        }

        .sync-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sync-label {
          font-size: 11px;
          font-weight: 600;
          color: #787774;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }

        .sync-value {
          font-size: 12px;
          color: #37352f;
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
          min-width: 120px;
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
          max-width: 420px;
          width: 100%;
          margin-bottom: 20px;
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

        .search-container {
          display: flex;
          align-items: center;
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 0 14px;
          height: 40px;
          transition: all 0.18s ease;
          box-shadow: inset 0 0 0 1px transparent;
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
          transition: color 0.18s ease;
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
          font-weight: 500;
          letter-spacing: 0.1px;
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
          margin-left: 8px;
          color: #787774;
          flex-shrink: 0;
          border-radius: 4px;
          transition: all 0.15s ease;
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
        
        .data-table td {
          padding: 14px 16px;
          border-bottom: 1px solid #f1f1ef;
          vertical-align: middle;
          background: #ffffff;
        }
        
        .data-table tbody tr {
          transition: background-color 0.15s ease;
        }
        
        .data-table tbody tr:hover {
          background: #f7f6f3;
        }
        
        .data-table tbody tr:hover td {
          background: #f7f6f3;
        }
        
        .data-table tbody tr.expanded-row {
          background: #fafafa;
        }
        
        .data-table tbody tr.expanded-row td {
          border-bottom: 1px solid #e9e9e7;
          background: #fafafa;
        }
        
        /* Shared Column Widths for TH and TD */
        .cell-expand {
          width: 48px;
          min-width: 48px;
          padding-left: 12px !important;
          padding-right: 12px !important;
          text-align: center;
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
          width: 240px;
          min-width: 240px;
          max-width: 240px;
        }
        
        .cell-caller .cell-content {
          -webkit-line-clamp: 2;
          font-weight: normal;
          color: #37352f;
          font-size: 12px;
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

        .source-twilio {
          background: rgba(55, 53, 47, 0.08);
          color: #37352f;
        }

        .source-freepbx {
          background: rgba(66, 133, 244, 0.15);
          color: #1a73e8;
        }
        
        .cell-date {
          width: 180px;
          min-width: 180px;
          max-width: 180px;
        }
        
        .cell-date .cell-content {
          -webkit-line-clamp: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
          font-size: 12px;
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
        
        .cell-sentiment .cell-content {
          display: block;
          -webkit-line-clamp: 1;
        }
        
        .cell-actions {
          min-width: 220px;
          max-width: 320px;
        }
        
        .cell-urgent {
          min-width: 180px;
          max-width: 280px;
        }
        
        .cell-audio {
          width: 140px;
          min-width: 140px;
          max-width: 140px;
        }
        
        .cell-audio .cell-content {
          display: flex;
          align-items: center;
          -webkit-line-clamp: 1;
        }
        
        .audio-play-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid #4285f4;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
          padding: 0;
          outline: none;
          color: #4285f4;
        }
        
        .audio-play-btn:hover {
          background: rgba(66, 133, 244, 0.08);
          border-color: #4285f4;
        }
        
        .audio-play-btn:active {
          transform: scale(0.95);
        }
        
        .audio-play-btn.playing {
          background: rgba(66, 133, 244, 0.12);
          border-color: #4285f4;
        }
        
        .audio-play-btn svg {
          width: 14px;
          height: 14px;
        }
        
        .detail-audio-btn {
          width: 40px;
          height: 40px;
        }
        
        .detail-audio-btn svg {
          width: 18px;
          height: 18px;
        }
        
        .audio-player-container {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
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
          color: #4285f4;
          font-variant-numeric: tabular-nums;
          min-width: 85px;
        }
        
        .time-current {
          color: #4285f4;
          font-weight: 500;
        }
        
        .time-separator {
          color: #4285f4;
        }
        
        .time-duration {
          color: #4285f4;
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
          background: #4285f4;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .audio-seek-bar::-webkit-slider-thumb:hover {
          background: #1a73e8;
          transform: scale(1.2);
        }
        
        .audio-seek-bar::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #4285f4;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .audio-seek-bar::-moz-range-thumb:hover {
          background: #1a73e8;
          transform: scale(1.2);
        }
        
        .no-audio {
          color: #9b9a97;
          font-size: 12px;
          font-style: italic;
        }
        
        .expanded-content-cell {
          padding: 20px 24px !important;
          background: #fafafa;
          border-bottom: 1px solid #e9e9e7 !important;
        }
        
        .expanded-details {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 16px;
          max-width: 1200px;
        }
        
        .detail-section {
          background: #ffffff;
          border: 1px solid #e9e9e7;
          border-radius: 6px;
          padding: 16px 20px;
        }
        
        .detail-section.transcript-section {
          grid-column: 3;
          grid-row: 1 / -1;
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
        
        .status-positive {
          background-color: rgba(46, 170, 220, 0.12);
          color: #0b6e99;
        }
        
        .status-negative {
          background-color: rgba(235, 87, 87, 0.12);
          color: #d1242f;
        }
        
        .status-neutral {
          background-color: rgba(55, 53, 47, 0.09);
          color: #37352f;
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
        
        .empty-state {
          text-align: center;
          padding: 100px 24px;
          background: #ffffff;
        }
        
        .empty-state-icon {
          font-size: 56px;
          margin-bottom: 20px;
          opacity: 0.3;
        }
        
        .empty-state-text {
          font-size: 15px;
          color: #787774;
          line-height: 1.6;
        }
        
        @media (max-width: 768px) {
          .header {
            padding: 16px 20px;
          }
          
          .header-title {
            font-size: 17px;
          }
          
          .header-cell {
            padding: 8px 12px;
            font-size: 10px;
          }

          .sync-panel {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .data-table td {
            padding: 12px;
            font-size: 13px;
          }
          
          .cell-expand {
            width: 44px;
            min-width: 44px;
            padding-left: 8px !important;
            padding-right: 8px !important;
          }
          
          .cell-caller,
          .cell-date,
          .cell-summary,
          .cell-actions,
          .cell-urgent {
            min-width: 150px;
            max-width: 200px;
          }
          
          .expanded-content-cell {
            padding: 16px !important;
          }
          
          .expanded-details {
            grid-template-columns: 1fr;
          }
        }

        /* Checkbox and selection styles */
        .cell-checkbox {
          width: 40px;
          padding: 12px;
          text-align: center;
        }

        .checkbox-select,
        .checkbox-select-all {
          width: 16px;
          height: 16px;
          cursor: pointer;
          accent-color: #4285f4;
        }

        .data-row.selected {
          background-color: #e8f0fe !important;
        }

        /* Bulk actions toolbar */
        .bulk-actions-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background-color: #e8f0fe;
          border: 1px solid #4285f4;
          border-radius: 6px;
          margin-bottom: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .selected-count {
          font-size: 14px;
          font-weight: 600;
          color: #1a73e8;
        }

        .btn-delete-bulk {
          background-color: #dc3545;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-delete-bulk:hover:not(:disabled) {
          background-color: #c82333;
        }

        .btn-delete-bulk:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-cancel {
          background-color: #f1f1f1;
          color: #333;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-cancel:hover {
          background-color: #e0e0e0;
        }

        /* Modal styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }

        .modal-content {
          background: white;
          border-radius: 8px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        }

        .modal-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 16px 0;
          color: #333;
        }

        .modal-message {
          font-size: 14px;
          color: #666;
          margin: 0 0 24px 0;
          line-height: 1.5;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }

        .btn-modal-cancel {
          background-color: #f1f1f1;
          color: #333;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-modal-cancel:hover {
          background-color: #e0e0e0;
        }

        .btn-modal-delete {
          background-color: #dc3545;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-modal-delete:hover:not(:disabled) {
          background-color: #c82333;
        }

        .btn-modal-delete:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </DashboardLayout>
  )
}
