/**
 * Timezone utility functions for formatting dates with user preferences
 */

/**
 * Format a date string in the user's timezone
 * @param dateString - ISO date string from the backend
 * @param timezone - IANA timezone identifier (e.g., 'America/New_York')
 * @param options - Intl.DateTimeFormatOptions for formatting
 * @returns Formatted date string
 */
export function formatDateInTimezone(
  dateString: string,
  timezone: string = 'UTC',
  options?: Intl.DateTimeFormatOptions
): string {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    
    // Default options if none provided
    const formatOptions: Intl.DateTimeFormatOptions = options || {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    };

    return new Intl.DateTimeFormat('en-US', {
      ...formatOptions,
      timeZone: timezone,
    }).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    // Fallback to local time if there's an error
    return new Date(dateString).toLocaleString();
  }
}

/**
 * Format a date string in the user's timezone (detailed format)
 * @param dateString - ISO date string from the backend
 * @param timezone - IANA timezone identifier
 * @returns Formatted date string with full details
 */
export function formatDetailedDate(
  dateString: string,
  timezone: string = 'UTC'
): string {
  return formatDateInTimezone(dateString, timezone, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Get a list of common timezones with their labels
 * @returns Array of timezone options for selection
 */
export function getCommonTimezones(): Array<{ value: string; label: string }> {
  return [
    { value: 'UTC', label: '(UTC+00:00) UTC' },
    { value: 'America/New_York', label: '(UTC-05:00) Eastern Time (US & Canada)' },
    { value: 'America/Chicago', label: '(UTC-06:00) Central Time (US & Canada)' },
    { value: 'America/Denver', label: '(UTC-07:00) Mountain Time (US & Canada)' },
    { value: 'America/Los_Angeles', label: '(UTC-08:00) Pacific Time (US & Canada)' },
    { value: 'America/Anchorage', label: '(UTC-09:00) Alaska' },
    { value: 'Pacific/Honolulu', label: '(UTC-10:00) Hawaii' },
    { value: 'America/Phoenix', label: '(UTC-07:00) Arizona' },
    { value: 'America/Toronto', label: '(UTC-05:00) Toronto' },
    { value: 'America/Vancouver', label: '(UTC-08:00) Vancouver' },
    { value: 'America/Mexico_City', label: '(UTC-06:00) Mexico City' },
    { value: 'America/Sao_Paulo', label: '(UTC-03:00) São Paulo' },
    { value: 'America/Buenos_Aires', label: '(UTC-03:00) Buenos Aires' },
    { value: 'Europe/London', label: '(UTC+00:00) London' },
    { value: 'Europe/Paris', label: '(UTC+01:00) Paris' },
    { value: 'Europe/Berlin', label: '(UTC+01:00) Berlin' },
    { value: 'Europe/Rome', label: '(UTC+01:00) Rome' },
    { value: 'Europe/Madrid', label: '(UTC+01:00) Madrid' },
    { value: 'Europe/Amsterdam', label: '(UTC+01:00) Amsterdam' },
    { value: 'Europe/Brussels', label: '(UTC+01:00) Brussels' },
    { value: 'Europe/Moscow', label: '(UTC+03:00) Moscow' },
    { value: 'Europe/Istanbul', label: '(UTC+03:00) Istanbul' },
    { value: 'Asia/Dubai', label: '(UTC+04:00) Dubai' },
    { value: 'Asia/Kolkata', label: '(UTC+05:30) Mumbai, Kolkata' },
    { value: 'Asia/Bangkok', label: '(UTC+07:00) Bangkok' },
    { value: 'Asia/Singapore', label: '(UTC+08:00) Singapore' },
    { value: 'Asia/Hong_Kong', label: '(UTC+08:00) Hong Kong' },
    { value: 'Asia/Shanghai', label: '(UTC+08:00) Beijing, Shanghai' },
    { value: 'Asia/Tokyo', label: '(UTC+09:00) Tokyo' },
    { value: 'Asia/Seoul', label: '(UTC+09:00) Seoul' },
    { value: 'Australia/Sydney', label: '(UTC+11:00) Sydney' },
    { value: 'Australia/Melbourne', label: '(UTC+11:00) Melbourne' },
    { value: 'Pacific/Auckland', label: '(UTC+13:00) Auckland' },
  ];
}

/**
 * Detect user's timezone from browser
 * @returns IANA timezone identifier
 */
export function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.error('Error detecting timezone:', error);
    return 'UTC';
  }
}

