'use client'

import { useState, useEffect, useRef } from 'react'
import { useCalls } from '@/hooks/use-calls'
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
  const { data: calls, isLoading } = useCalls({ limit: 100 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({})
  const [audioTimes, setAudioTimes] = useState<{ [key: string]: { current: number, duration: number } }>({})

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
    const caller = `${call.callerName || ''} ${call.callerNumber}`.toLowerCase()
    const transcript = call.transcript?.toLowerCase() || ''
    const analysis = call.analysis?.toLowerCase() || ''
    return caller.includes(query) || transcript.includes(query) || analysis.includes(query)
  }) || []

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

  return (
    <DashboardLayout>
      <div className="app-container">
        <div className="header">
          <div className="header-content">
            <h1 className="header-title">Interactions</h1>
            <p className="header-subtitle">View and manage your call interactions • {filteredCalls.length} calls</p>
          </div>
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
          {filteredCalls.length > 0 && (
            <div className="column-headers">
              <div className="header-cell cell-expand"></div>
              <div className="header-cell cell-caller">Caller</div>
              <div className="header-cell cell-date">Date & Time</div>
              <div className="header-cell cell-summary">Summary</div>
              <div className="header-cell cell-sentiment">Sentiment</div>
              <div className="header-cell cell-actions">Action Items</div>
              <div className="header-cell cell-urgent">Urgent Topics</div>
              <div className="header-cell cell-audio">Listen</div>
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
              <tbody>
                {filteredCalls.map((call, index) => {
                  const rowId = `row-${index}`
                  const isExpanded = expandedRows.has(rowId)
                  const parsed = parseAnalysis(call.analysis)
                  const sentimentBadge = getSentimentBadge(parsed.sentiment)
                  const hasUrgent = hasUrgentTopics(parsed.urgentTopics)
                  const displayCaller = call.callerName 
                    ? `${call.callerName} (${call.callerNumber})` 
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
                        <td className="cell-caller">
                          <div className="cell-content">{displayCaller}</div>
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
                        <td className="cell-audio">
                          <div className="cell-content">
                            {call.recordingUrl ? (
                              <>
                                <button
                                  className={`audio-play-btn ${playingAudio === call.id ? 'playing' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleAudio(call.id)
                                  }}
                                  aria-label="Play audio"
                                >
                                  {playingAudio === call.id ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                    </svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M8 5v14l11-7z"/>
                                    </svg>
                                  )}
                                </button>
                                <audio
                                  ref={(el) => {
                                    if (el) audioRefs.current[call.id] = el
                                  }}
                                  preload="none"
                                  onEnded={() => handleAudioEnded(call.id)}
                                >
                                  <source src={`/api/audio/${call.id}`} type="audio/wav" />
                                </audio>
                              </>
                            ) : (
                              <span className="no-audio">—</span>
                            )}
                          </div>
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
                              {call.recordingUrl && (
                                <div className="detail-section">
                                  <div className="detail-label">Audio Recording</div>
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
        
        .column-headers {
          display: flex;
          align-items: center;
          padding: 12px 0 0 0;
          border-top: 1px solid #e9e9e7;
          margin-top: 16px;
          background: #ffffff;
        }
        
        .header-cell {
          padding: 10px 16px;
          font-weight: 600;
          font-size: 11px;
          color: #787774;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          white-space: nowrap;
          flex-shrink: 0;
          text-align: left;
          line-height: 1.4;
        }
        
        .header-cell.cell-expand {
          width: 48px;
          padding: 10px 12px;
          flex-shrink: 0;
          text-align: center;
        }
        
        .header-cell.cell-caller {
          width: 240px;
          min-width: 240px;
          max-width: 240px;
        }
        
        .header-cell.cell-date {
          width: 180px;
          min-width: 180px;
          max-width: 180px;
        }
        
        .header-cell.cell-summary {
          min-width: 280px;
          max-width: 400px;
          flex: 1;
        }
        
        .header-cell.cell-sentiment {
          width: 110px;
          min-width: 110px;
          max-width: 110px;
        }
        
        .header-cell.cell-actions {
          min-width: 220px;
          max-width: 320px;
          flex: 1;
        }
        
        .header-cell.cell-urgent {
          min-width: 180px;
          max-width: 280px;
          flex: 1;
        }
        
        .header-cell.cell-audio {
          width: 140px;
          min-width: 140px;
          max-width: 140px;
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
        
        .cell-expand {
          width: 48px;
          padding: 14px 12px !important;
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
          font-size: 14px;
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
          max-width: 300px;
        }
        
        .cell-caller .cell-content {
          -webkit-line-clamp: 2;
          font-weight: normal;
          color: #37352f;
          font-size: 14px;
        }
        
        .cell-date {
          width: 180px;
          min-width: 180px;
          max-width: 200px;
          color: #787774;
          font-size: 13px;
        }
        
        .cell-date .cell-content {
          -webkit-line-clamp: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
        }
        
        .cell-summary {
          min-width: 280px;
          max-width: 400px;
        }
        
        .cell-sentiment {
          width: 110px;
          min-width: 110px;
          max-width: 130px;
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
          max-width: 180px;
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
          border: 1px solid #e9e9e7;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
          padding: 0;
          outline: none;
          color: #37352f;
        }
        
        .audio-play-btn:hover {
          background: #f7f6f3;
          border-color: #d1d1cf;
        }
        
        .audio-play-btn:active {
          transform: scale(0.95);
        }
        
        .audio-play-btn.playing {
          background: #f1f1ef;
          border-color: #37352f;
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
          color: #787774;
          font-variant-numeric: tabular-nums;
          min-width: 85px;
        }
        
        .time-current {
          color: #37352f;
          font-weight: 500;
        }
        
        .time-separator {
          color: #9b9a97;
        }
        
        .time-duration {
          color: #787774;
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
          background: #37352f;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .audio-seek-bar::-webkit-slider-thumb:hover {
          background: #1a1918;
          transform: scale(1.2);
        }
        
        .audio-seek-bar::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #37352f;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .audio-seek-bar::-moz-range-thumb:hover {
          background: #1a1918;
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
          font-size: 14px;
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
          font-size: 14px;
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
          font-size: 14px;
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
          
          .column-headers {
            padding: 10px 0 0 0;
            margin-top: 12px;
          }
          
          .header-cell {
            padding: 8px 12px;
            font-size: 10px;
          }
          
          .header-cell.cell-expand {
            width: 44px;
            padding: 8px 8px;
          }
          
          .header-cell.cell-caller,
          .header-cell.cell-date,
          .header-cell.cell-summary,
          .header-cell.cell-actions,
          .header-cell.cell-urgent {
            min-width: 150px;
            max-width: 200px;
          }
          
          .data-table td {
            padding: 12px;
            font-size: 13px;
          }
          
          .cell-expand {
            width: 44px;
            padding: 12px 8px !important;
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
      `}</style>
    </DashboardLayout>
  )
}
