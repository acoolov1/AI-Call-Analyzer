import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { useAdminUser } from '@/contexts/AdminUserContext';
import { User } from './use-user';

/**
 * Hook that fetches the currently selected user's data
 * If admin has selected another user, fetches that user's data
 * Otherwise, fetches the current logged-in user's data
 */
export function useSelectedUser() {
  const { selectedUserId } = useAdminUser();
  
  return useQuery<User>({
    queryKey: ['user', selectedUserId || 'current'],
    queryFn: async () => {
      try {
        const url = selectedUserId 
          ? `/api/v1/user?userId=${selectedUserId}`
          : '/api/v1/user';
        const { data } = await apiClient.get(url);
        return data.data;
      } catch (error: any) {
        console.error('Error fetching selected user:', error.response?.data || error.message);
        throw error;
      }
    },
    retry: 1,
    retryDelay: 1000,
  });
}

