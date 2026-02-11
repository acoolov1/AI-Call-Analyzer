import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { FreePbxSettings, TwilioSettings, OpenAISettings } from '@/types/call';
export type { TwilioSettings } from '@/types/call';

// User type matching backend response
export interface User {
  id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'user';
  isAdmin: boolean;
  canUseApp: boolean;
  canUseFreepbxManager: boolean;
  createdAt: string;
  updatedAt: string;
  subscriptionTier: 'free' | 'pro' | 'enterprise';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  timezone?: string;
  fullName?: string;
  companyName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  tosAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
  tosVersion?: string;
  privacyVersion?: string;
  twilioSettings?: TwilioSettings;
  freepbxSettings?: FreePbxSettings;
  openaiSettings?: OpenAISettings;
  billingSettings?: {
    basePlanMonthlyChargeUsd?: number | null;
    basePlanIncludedAudioHours?: number | null;
  };
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

