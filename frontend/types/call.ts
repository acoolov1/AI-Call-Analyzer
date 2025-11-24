export type CallStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type CallSource = 'twilio' | 'freepbx';

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

export interface FreePbxSettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  tls: boolean;
  syncIntervalMinutes: number;
  hasPassword?: boolean;
}

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
  recordingPath?: string;
  status: CallStatus;
  duration?: number;
  source?: CallSource;
  externalId?: string;
  externalCreatedAt?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  syncedAt?: string | null;
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

