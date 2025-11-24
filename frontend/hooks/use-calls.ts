import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { Call, CallStats, FreePbxSettings } from '@/types/call';

interface FreePbxStatus {
  freepbxSettings: FreePbxSettings;
  lastRun?: {
    at?: string;
    synced?: number;
    reason?: string;
    error?: string;
  };
  enabled?: boolean;
}

// Fetch calls list
export function useCalls(options?: { limit?: number; offset?: number; status?: string }) {
  return useQuery<Call[]>({
    queryKey: ['calls', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.limit) params.append('limit', String(options.limit));
      if (options?.offset) params.append('offset', String(options.offset));
      if (options?.status) params.append('status', options.status);
      
      const { data } = await apiClient.get(`/api/v1/calls?${params.toString()}`);
      return data.data;
    },
  });
}

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
export function useStats() {
  return useQuery<CallStats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/v1/stats');
      return data.data;
    },
  });
}

// Delete call mutation
export function useDeleteCall() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/v1/calls/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      await queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// Bulk delete calls
export function useBulkDeleteCalls() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (callIds: string[]) => {
      const { data } = await apiClient.delete('/api/v1/calls/bulk/delete', {
        data: { callIds }
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calls'] });
      await queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// Retry call mutation
export function useRetryCall() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(`/api/v1/calls/${id}/retry`);
      return data.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['call', id] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useFreepbxStatus() {
  return useQuery<FreePbxStatus>({
    queryKey: ['freepbx-status'],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/v1/integrations/freepbx/status');
      return data.data;
    },
  });
}

export function useFreepbxSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/api/v1/integrations/freepbx/sync');
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freepbx-status'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
    },
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

