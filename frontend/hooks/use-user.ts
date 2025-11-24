import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { FreePbxSettings, TwilioSettings } from '@/types/call';

// User type matching backend response
export interface User {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  subscriptionTier: 'free' | 'pro' | 'enterprise';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  timezone?: string;
  twilioSettings?: TwilioSettings;
  freepbxSettings?: FreePbxSettings;
}

// Fetch current user information
export function useUser() {
  const query = useQuery<User>({
    queryKey: ['user'],
    queryFn: async () => {
      try {
        const { data } = await apiClient.get('/api/v1/user');
        return data.data;
      } catch (error: any) {
        console.error('Error fetching user:', error.response?.data || error.message);
        throw error;
      }
    },
    retry: 1,
    retryDelay: 1000,
  });

  return {
    ...query,
    mutate: query.refetch,
  };
}

