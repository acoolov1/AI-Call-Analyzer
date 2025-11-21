export type CallStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Call {
  id: string;
  userId: string;
  callSid?: string;
  recordingSid?: string;
  callerNumber: string;
  callerName?: string;
  transcript?: string;
  analysis?: string;
  recordingUrl?: string;
  status: CallStatus;
  duration?: number;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
}

export interface CallStats {
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  positiveSentiment: number;
  negativeSentiment: number;
  neutralSentiment: number;
  urgentTopics: number;
  recentCalls: Call[];
}

