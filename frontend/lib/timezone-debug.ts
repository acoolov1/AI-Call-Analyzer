/**
 * Debug utility to test timezone conversion
 */

export function debugTimezoneConversion(dateString: string, timezone: string) {
  console.group('🐛 Timezone Debug');
  console.log('Input date string:', dateString);
  console.log('Target timezone:', timezone);
  
  const date = new Date(dateString);
  console.log('Parsed Date object:', date);
  console.log('Date.toISOString():', date.toISOString());
  console.log('Date.toString():', date.toString());
  
  // Test the formatting
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: timezone,
    }).format(date);
    
    console.log('Formatted result:', formatted);
    
    // Also show in UTC for comparison
    const utcFormatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: 'UTC',
    }).format(date);
    
    console.log('Same time in UTC:', utcFormatted);
  } catch (error) {
    console.error('Formatting error:', error);
  }
  
  console.groupEnd();
}

