import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { User } from './use-user';

export interface AdminUser {
  id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'user';
  canUseApp: boolean;
  canUseFreepbxManager: boolean;
  subscriptionTier: string;
  fullName?: string;
  companyName?: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  callCount: number;
  hasOpenAISettings: boolean;
  hasFreePBXSettings: boolean;
  hasTwilioSettings: boolean;
}

export interface UserDetails extends User {
  callCount: number;
}

// Fetch all users (admin only)
export function useAllUsers(options?: { enabled?: boolean }) {
  return useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/v1/admin/users');
      return data.data;
    },
    enabled: options?.enabled ?? true,
    retry: 1,
  });
}

// Fetch specific user details (admin only)
export function useUserDetails(userId: string | null) {
  return useQuery<UserDetails>({
    queryKey: ['admin', 'users', userId],
    queryFn: async () => {
      if (!userId) throw new Error('User ID required');
      const { data } = await apiClient.get(`/api/v1/admin/users/${userId}`);
      return data.data;
    },
    enabled: !!userId,
    retry: 1,
  });
}

// Update user role (admin only)
export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'admin' | 'user' }) => {
      const { data } = await apiClient.patch(
        `/api/v1/admin/users/${userId}/role`,
        { role }
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useUpdateUserAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      canUseApp,
      canUseFreepbxManager,
    }: {
      userId: string;
      canUseApp?: boolean;
      canUseFreepbxManager?: boolean;
    }) => {
      const { data } = await apiClient.patch(`/api/v1/admin/users/${userId}/access`, {
        ...(typeof canUseApp === 'boolean' ? { canUseApp } : {}),
        ...(typeof canUseFreepbxManager === 'boolean' ? { canUseFreepbxManager } : {}),
      });
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useCreateAdminUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      email: string;
      password: string;
      role: 'admin' | 'user';
      canUseApp: boolean;
      canUseFreepbxManager: boolean;
    }) => {
      const { data } = await apiClient.post('/api/v1/admin/users', payload);
      return data.data as AdminUser;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

// Delete user (admin only)
export function useDeleteUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data } = await apiClient.delete(`/api/v1/admin/users/${userId}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

// Fetch user calls (admin only)
export function useUserCalls(userId: string | null, options?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['admin', 'users', userId, 'calls', options],
    queryFn: async () => {
      if (!userId) throw new Error('User ID required');
      const params = new URLSearchParams();
      if (options?.limit) params.append('limit', String(options.limit));
      if (options?.offset) params.append('offset', String(options.offset));
      
      const { data } = await apiClient.get(
        `/api/v1/admin/users/${userId}/calls?${params.toString()}`
      );
      return data;
    },
    enabled: !!userId,
    retry: 1,
  });
}

