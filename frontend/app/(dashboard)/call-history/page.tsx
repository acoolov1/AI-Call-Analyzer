'use client'

import { useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { useCdrCalls, useCdrSync, useCdrStatus } from '@/hooks/use-calls'
import { useUser } from '@/hooks/use-user'
import { parseAnalysis, getSentimentBadge, createPreview } from '@/lib/analysis-parser'
import { formatDateInTimezone } from '@/lib/timezone'

export default function CallHistoryPage() {
  const { data: session, status } = useSession()
  const { data: user } = useUser()
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const loadedMetadataRef = useRef<Record<string, boolean>>({})
  const [audioTimes, setAudioTimes] = useState<Record<string, { current: number; duration: number }>>({})

  const limit = 50
  const { data: cdrData, isLoading, refetch } = useCdrCalls(currentPage, limit)
  const { data: cdrStatus, isLoading: isStatusLoading } = useCdrStatus()
  const syncMutation = useCdrSync()

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (isLoading) {
    return <div>Loading call history...</div>
  }

  const calls = cdrData?.calls || []
  const pagination = cdrData?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 }

  const filteredCalls = calls.filter((call: any) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const caller = `${call.callerName || ''} ${call.callerNumber}`.toLowerCase()
    const callee = `${call.sourceMetadata?.dst_cnam || ''} ${call.sourceMetadata?.dst || ''}`.toLowerCase()
    const transcript = call.transcript?.toLowerCase() || ''
    const analysis = call.analysis?.toLowerCase() || ''
    return caller.includes(query) || callee.includes(query) || transcript.includes(query) || analysis.includes(query)
  })

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

  const handleManualSync = () => {
    setSyncMessage(null)
    syncMutation.mutate(undefined, {
      onSuccess: () => {
        setSyncMessage('CDR sync started. New calls will appear shortly.')
        refetch()
      },
      onError: (error: any) => {
        const msg = error?.response?.data?.message || 'Failed to start CDR sync.'
        setSyncMessage(msg)
      },
      onSettled: () => {
        setTimeout(() => setSyncMessage(null), 4000)
      },
    })
  }

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
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
    setAudioTimes(prev => ({
      ...prev,
      [audioId]: {
        current: audio.currentTime,
        duration: audio.duration || 0,
      },
    }))
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

  return (
    <DashboardLayout>
      <div className="app-container">
        <div className="header">
          <div className="header-content">
            <h1 className="header-title">Call History</h1>
            <p className="header-subtitle">
              View and manage call history from FreePBX CDR • {pagination.total} calls
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
            {cdrStatus?.freepbxCdrSettings?.enabled && (
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
                <button
                  type="button"
                  className="sync-btn"
                  onClick={handleManualSync}
                  disabled={syncMutation.isPending}
                >
                  {syncMutation.isPending ? 'Syncing...' : 'Sync CDR'}
                </button>
              </div>
            )}
          </div>
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
              {searchQuery ? 'No calls match your search' : 'No call history available. Configure MySQL CDR access in Settings.'}
            </div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="header-cell cell-expand"></th>
                  <th className="header-cell cell-date">Date & Time</th>
                  <th className="header-cell cell-caller">Caller</th>
                  <th className="header-cell cell-caller">Callee</th>
                  <th className="header-cell cell-summary">Summary</th>
                  <th className="header-cell cell-sentiment">Sentiment</th>
                  <th className="header-cell cell-urgent">Urgent Topics</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call: any, index: number) => {
                  const rowId = `row-${index}`
                  const isExpanded = expandedRows.has(rowId)
                  const parsed = parseAnalysis(call.analysis)
                  const sentimentBadge = getSentimentBadge(parsed.sentiment)
                  const hasUrgent = parsed.urgentTopics && parsed.urgentTopics.toLowerCase() !== 'none'
                  const detailAudioId = `${call.id}-detail`

                  const rawTimestamp = call.externalCreatedAt || call.createdAt;
                  const userTz = user?.timezone || 'America/New_York';
                  
                  // Debug logging for first call only
                  if (index === 0) {
                    console.log('🔍 First call debug:');
                    console.log('  Raw timestamp:', rawTimestamp);
                    console.log('  User timezone:', userTz);
                    console.log('  Parsed Date:', new Date(rawTimestamp));
                  }
                  
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

                  const calleeName = call.sourceMetadata?.dst_cnam || null
                  const calleeNumber = call.sourceMetadata?.dst || 'Unknown'

                  return (
                    <>
                      <tr
                        key={call.id}
                        className={`data-row ${isExpanded ? 'expanded' : ''}`}
                        data-row-id={rowId}
                        onClick={() => toggleRow(rowId)}
                        style={{ cursor: 'pointer' }}
                      >
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
                          <div className="cell-content">{createPreview(parsed.summary, 80)}</div>
                        </td>
                        <td className="cell-sentiment">
                          <div className="cell-content">
                            <span className={`status-badge ${sentimentBadge.class}`}>{sentimentBadge.text}</span>
                          </div>
                        </td>
                        <td className="cell-urgent">
                          <div className="cell-content">{createPreview(hasUrgent ? parsed.urgentTopics : 'None', 50)}</div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="expanded-row" data-expanded-for={rowId}>
                          <td colSpan={7} className="expanded-content-cell">
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
                              {call.recordingPath && (
                                <div className="detail-section">
                                  <div className="detail-label">Listen</div>
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
                                          disabled={!audioTimes[detailAudioId]?.duration || audioTimes[detailAudioId]?.duration <= 0}
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
                                      preload="metadata"
                                      onEnded={() => handleAudioEnded(detailAudioId)}
                                      onTimeUpdate={() => handleTimeUpdate(detailAudioId)}
                                      onLoadedMetadata={() => handleLoadedMetadata(detailAudioId)}
                                      onDurationChange={() => handleDurationChange(detailAudioId)}
                                    >
                                      <source src={`/api/audio/${call.id}`} type="audio/wav" />
                                    </audio>
                                  </div>
                                </div>
                              )}
                              {!call.recordingPath && (
                                <div className="detail-section">
                                  <div className="detail-label">Listen</div>
                                  <div className="detail-value no-audio">
                                    No recording available for this call
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
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }

        .sync-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .sync-info {
          display: flex;
          align-items: center;
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
          max-width: 420px;
          width: 100%;
          flex: 1;
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
    </DashboardLayout>
  )
}

