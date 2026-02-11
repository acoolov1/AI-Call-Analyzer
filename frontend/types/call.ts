export type CallStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type CallSource = 'twilio' | 'freepbx' | 'freepbx-cdr';

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
  enabled?: boolean;
  integration_date?: string; // ISO date string - when FreePBX was first enabled
  mysql_host?: string;
  mysql_port?: number;
  mysql_username?: string;
  mysql_database?: string;
  hasMysqlPassword?: boolean;
  call_history_include_inbound?: boolean;
  call_history_include_outbound?: boolean;
  call_history_include_internal?: boolean;
  call_history_excluded_inbound_extensions?: string[];
  call_history_excluded_outbound_extensions?: string[];
  call_history_excluded_internal_extensions?: string[];
  call_recording_overrides?: Record<
    string,
    {
      inExternal?: boolean;
      outExternal?: boolean;
      inInternal?: boolean;
      outInternal?: boolean;
    }
  >;
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  ssh_base_path?: string;
  hasSshPassword?: boolean;
  hasSshPrivateKey?: boolean;
  retention_enabled?: boolean;
  retention_days?: number;
  retention_run_time?: string; // HH:MM (24h)
  retention_next_run_at?: string | null; // ISO UTC
  retention_last_run_at?: string | null; // ISO UTC
  retention_last_result?: any;
  voicemail_enabled?: boolean;
  voicemail_base_path?: string;
  voicemail_context?: string;
  voicemail_folders?: string[];
  voicemail_sync_interval_minutes?: number;
  voicemail_last_sync_at?: string | null;
  voicemail_next_sync_at?: string | null;
  voicemail_last_result?: any;
}

export interface OpenAISettings {
  enabled: boolean;
  whisperModel: string;
  gptModel: string;
  hasApiKey?: boolean;
  analysisPrompt?: string;
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
  recordingDeletedAt?: string | null;
  recordingDeletedReason?: string | null;
  status: CallStatus;
  duration?: number;
  source?: CallSource;
  externalId?: string;
  externalCreatedAt?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  direction?: 'inbound' | 'outbound' | 'internal' | null;
  redactionStatus?: string | null;
  redacted?: boolean;
  redactedSegments?: any;
  redactedAt?: string | null;
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

