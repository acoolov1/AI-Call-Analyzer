import { useQuery } from '@tanstack/react-query'
import apiClient from '@/lib/api-client'
import { buildApiUrl } from '@/lib/api-helpers'

export type OpenAIUsageHistoryPoint = {
  day: string
  callsProcessed: number
  whisperModelRequests: number
  audioSeconds: number
  audioMinutes: number
  whisperEstimatedSpend: number
}

export function useOpenAIUsageHistory(params: {
  viewingUserId?: string | null
  scope?: 'all' | 'user'
  startDate?: string | null
  endDate?: string | null
  enabled?: boolean
}) {
  const { viewingUserId, scope, startDate, endDate, enabled = true } = params || {}

  return useQuery<{ points: OpenAIUsageHistoryPoint[] }>({
    queryKey: ['openai-usage-history', { viewingUserId, scope, startDate, endDate }],
    enabled,
    queryFn: async () => {
      const url = buildApiUrl('/api/v1/integrations/openai/usage-history', viewingUserId)
      const q: any = {}
      if (startDate) q.startDate = startDate
      if (endDate) q.endDate = endDate
      if (scope === 'all') q.scope = 'all'
      const { data } = await apiClient.get(url, { params: q })
      return data
    },
    staleTime: 30000,
    retry: 2,
  })
}

