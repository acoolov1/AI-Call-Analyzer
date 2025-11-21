import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

// Twilio settings type
export interface TwilioSettings {
  forwardingEnabled: boolean;
  forwardPhoneNumber: string;
  recordingEnabled: boolean;
  callTimeout: number;
  customGreeting: string;
  playRecordingBeep: boolean;
  maxRecordingLength: number;
  finishOnKey: string;
  afterHoursMessage: string;
  recordingMode: 'record-from-answer' | 'record-from-ringing' | 'do-not-record';
}

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

