/**
 * Helper to build API URL with optional userId query parameter for admin access
 */
export function buildApiUrl(path: string, userId?: string | null): string {
  if (!userId) {
    return path;
  }
  
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}userId=${encodeURIComponent(userId)}`;
}

