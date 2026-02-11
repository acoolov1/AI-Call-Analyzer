import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { Call, CallStats } from '@/types/call';

type CallsQueryOptions = {
  limit?: number;
  offset?: number;
  status?: string;
  userId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

// Fetch single call
export function useCall(id: string) {
  return useQuery<Call>({
    queryKey: ['call', id],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/calls/${id}`);
      return data.data;
    },
    enabled: !!id,
  });
}

// Fetch stats
export function useStats(userId?: string | null, options?: { enabled?: boolean }) {
  return useQuery<CallStats>({
    queryKey: ['stats', userId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.append('userId', userId);
      const { data } = await apiClient.get(`/api/v1/stats?${params.toString()}`);
      return data.data;
    },
    enabled: options?.enabled ?? true,
  });
}

export function useFreepbxTestConnection() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/api/v1/integrations/freepbx/test');
      return data.data;
    },
  });
}

export function useFreepbxCdrTestConnection() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/api/v1/integrations/freepbx/cdr/test');
      return data.data;
    },
  });
}

export function useFreepbxSshTestConnection() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/api/v1/integrations/freepbx/test-ssh');
      return data.data;
    },
  });
}

export function useCdrCalls(
  page: number = 1,
  limit: number = 50,
  userId?: string | null,
  options?: {
    startDate?: string | null;
    endDate?: string | null;
    direction?: 'inbound' | 'outbound' | null;
    booking?: 'Booked' | 'Not Booked' | 'Rescheduled' | 'Canceled' | 'unknown' | null;
    sentiment?: 'positive' | 'neutral' | 'negative' | 'unknown' | null;
    notAnswered?: boolean;
    search?: string | null;
    enabled?: boolean;
  }
) {
  return useQuery({
    queryKey: [
      'cdr-calls',
      page,
      limit,
      userId,
      options?.startDate,
      options?.endDate,
      options?.direction,
      options?.booking,
      options?.sentiment,
      options?.notAnswered,
      options?.search,
    ],
    queryFn: async () => {
      const params: any = { page, limit };
      if (userId) params.userId = userId;
      if (options?.startDate) params.startDate = options.startDate;
      if (options?.endDate) params.endDate = options.endDate;
      if (options?.direction) params.direction = options.direction;
      if (options?.booking) params.booking = options.booking;
      if (options?.sentiment) params.sentiment = options.sentiment;
      if (options?.notAnswered) params.notAnswered = true;
      if (options?.search && String(options.search).trim()) params.search = String(options.search).trim();
      const { data } = await apiClient.get('/api/v1/cdr-calls', {
        params,
      });
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useCdrSync(userId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const params = userId ? `?userId=${userId}` : '';
      const { data } = await apiClient.post(`/api/v1/integrations/freepbx/cdr/sync${params}`);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cdr-calls'] });
      queryClient.invalidateQueries({ queryKey: ['cdr-status'] });
    },
  });
}

export function useCdrStatus(userId?: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['cdr-status', userId],
    queryFn: async () => {
      const params = userId ? `?userId=${userId}` : '';
      const { data } = await apiClient.get(`/api/v1/integrations/freepbx/cdr/status${params}`);
      return data;
    },
    enabled: options?.enabled ?? true,
  });
}

// Delete single call
export function useDeleteCall(userId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const params = userId ? `?userId=${userId}` : '';
      const { data } = await apiClient.delete(`/api/v1/calls/${id}${params}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cdr-calls'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// Bulk delete calls
export function useBulkDeleteCalls(userId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (callIds: string[]) => {
      const params = userId ? `?userId=${userId}` : '';
      const { data } = await apiClient.delete(`/api/v1/calls/bulk/delete${params}`, {
        data: { callIds },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cdr-calls'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// OpenAI test connection
export function useOpenAITestConnection() {
  return useMutation({
    mutationFn: async (settings: { apiKey?: string; whisperModel: string; gptModel: string }) => {
      const { data } = await apiClient.post('/api/v1/integrations/openai/test', {
        apiKey: settings.apiKey,
        whisperModel: settings.whisperModel,
        gptModel: settings.gptModel,
      });
      return data.data;
    },
  });
}
