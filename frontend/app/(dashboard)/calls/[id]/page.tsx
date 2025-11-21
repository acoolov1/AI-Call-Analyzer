'use client'

import { useCall, useRetryCall } from '@/hooks/use-calls'
import { useUser } from '@/hooks/use-user'
import { useSession } from 'next-auth/react'
import { redirect, useParams } from 'next/navigation'
import { formatDateInTimezone } from '@/lib/timezone'

export default function CallDetailPage() {
  const { data: session, status } = useSession()
  const { data: user } = useUser()
  const params = useParams()
  const callId = params.id as string
  const { data: call, isLoading } = useCall(callId)
  const retryCall = useRetryCall()

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/login')
  }

  if (isLoading) {
    return <div>Loading call details...</div>
  }

  if (!call) {
    return <div>Call not found</div>
  }

  const handleRetry = async () => {
    await retryCall.mutateAsync(callId)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <a href="/calls" className="text-indigo-600 hover:text-indigo-900 mb-4 inline-block">
            ← Back to calls
          </a>
          <h1 className="text-3xl font-bold">Call Details</h1>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <h2 className="text-sm font-medium text-gray-500">Caller</h2>
            <p className="mt-1 text-lg">{call.callerName || call.callerNumber}</p>
          </div>

          <div>
            <h2 className="text-sm font-medium text-gray-500">Status</h2>
            <span className={`mt-1 inline-block px-2 py-1 text-xs rounded ${
              call.status === 'completed' ? 'bg-green-100 text-green-800' :
              call.status === 'failed' ? 'bg-red-100 text-red-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {call.status}
            </span>
            {call.status === 'failed' && (
              <button
                onClick={handleRetry}
                className="ml-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Retry Processing
              </button>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium text-gray-500">Date</h2>
            <p className="mt-1">{formatDateInTimezone(call.createdAt, user?.timezone || 'UTC')}</p>
          </div>

          {call.transcript && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-2">Transcript</h2>
              <div className="bg-gray-50 p-4 rounded">
                <p className="whitespace-pre-wrap">{call.transcript}</p>
              </div>
            </div>
          )}

          {call.analysis && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-2">Analysis</h2>
              <div className="bg-gray-50 p-4 rounded">
                <p className="whitespace-pre-wrap">{call.analysis}</p>
              </div>
            </div>
          )}

          {call.recordingUrl && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-2">Recording</h2>
              <audio controls className="w-full">
                <source src={`${process.env.NEXT_PUBLIC_API_URL}/audio/${call.id}`} type="audio/wav" />
              </audio>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

