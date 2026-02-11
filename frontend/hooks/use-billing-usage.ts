import { useQuery } from '@tanstack/react-query'
import apiClient from '@/lib/api-client'
import { buildApiUrl } from '@/lib/api-helpers'

export type BillingAudioDailyPoint = {
  day: string
  audioSeconds: number
  audioMinutes: number
  overageSeconds: number
  overageMinutes: number
}

export type BillingMonthlyRow = {
  month: string
  basePlanMonthlyChargeUsd: number
  basePlanIncludedAudioHours: number
  audioSeconds: number
  audioMinutes: number
  overageSeconds: number
  overageMinutes: number
  overageChargeUsd: number
  totalChargeUsd: number
  isFinalized: boolean
  calculatedAt: string | null
}

export function useBillingAudioDaily(params: {
  viewingUserId?: string | null
  startDate?: string | null
  endDate?: string | null
  enabled?: boolean
}) {
  const { viewingUserId, startDate, endDate, enabled = true } = params || {}

  return useQuery<{ points: BillingAudioDailyPoint[] }>({
    queryKey: ['billing-audio-daily', { viewingUserId, startDate, endDate }],
    enabled: enabled && Boolean(startDate && endDate),
    queryFn: async () => {
      const url = buildApiUrl('/api/v1/billing/audio-daily', viewingUserId)
      const { data } = await apiClient.get(url, { params: { startDate, endDate } })
      return data
    },
    staleTime: 30000,
    retry: 2,
  })
}

export function useBillingMonthlyHistory(params: {
  viewingUserId?: string | null
  months?: number
  enabled?: boolean
}) {
  const { viewingUserId, months = 12, enabled = true } = params || {}

  return useQuery<{ months: BillingMonthlyRow[]; whisperOurPricePerMinute: number | null }>({
    queryKey: ['billing-monthly-history', { viewingUserId, months }],
    enabled,
    queryFn: async () => {
      const url = buildApiUrl('/api/v1/billing/monthly-history', viewingUserId)
      const { data } = await apiClient.get(url, { params: { months } })
      return data
    },
    staleTime: 30000,
    retry: 2,
  })
}

