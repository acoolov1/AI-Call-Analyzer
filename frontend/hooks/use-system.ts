import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    cores: number;
    loadAverage: number[];
    status: 'healthy' | 'warning' | 'critical';
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentUsed: number;
    status: 'healthy' | 'warning' | 'critical';
    process: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  disk: {
    total: string;
    used: string;
    available: string;
    percentUsed: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  processes: Array<{
    user: string;
    pid: string;
    cpu: number;
    mem: number;
    command: string;
  }>;
  services: {
    backend: {
      status: string;
      message: string;
      uptime?: number;
    };
    frontend: {
      status: string;
      message: string;
    };
    database: {
      status: string;
      message: string;
      connections?: number;
    };
    redis: {
      status: string;
      message: string;
    };
  };
  network: {
    interfaces: string[];
    connections: number;
  };
  uptime: {
    seconds: number;
    formatted: string;
  };
}

export function useSystemMetrics() {
  return useQuery<SystemMetrics>({
    queryKey: ['system-metrics'],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/v1/admin/system');
      return data;
    },
    refetchInterval: false, // Snapshot on load (not real-time)
    staleTime: 30000, // Cache for 30 seconds
    retry: 2,
  });
}

export type SystemMetricsHistoryPoint = {
  hour: string | null;
  cpu: number;
  memory: number;
  disk: number;
};

export function useSystemMetricsHistory(params: { startDate?: string | null; endDate?: string | null }) {
  const { startDate, endDate } = params || {};
  return useQuery<{ startDate: string; endDate: string; points: SystemMetricsHistoryPoint[] }>({
    queryKey: ['system-metrics-history', { startDate, endDate }],
    queryFn: async () => {
      const q: any = {};
      if (startDate) q.startDate = startDate;
      if (endDate) q.endDate = endDate;
      const { data } = await apiClient.get('/api/v1/admin/system/history', { params: q });
      return data;
    },
    staleTime: 30000,
    retry: 2,
  });
}

