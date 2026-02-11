import { User } from '@/hooks/use-user';

/**
 * Check if user is Super Admin
 */
export function isSuperAdmin(user: User | null | undefined): boolean {
  return user?.role === 'super_admin';
}

/**
 * Check if user is an admin (admin or super_admin)
 */
export function isAdmin(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin' || user?.isAdmin === true;
}

export function canUseApp(user: User | null | undefined): boolean {
  // Default to true for older rows until migration is applied everywhere
  return user?.canUseApp !== false;
}

export function canUseFreepbxManager(user: User | null | undefined): boolean {
  return user?.canUseFreepbxManager === true || user?.role === 'super_admin';
}

/**
 * Check if user can access User Management page (/admin)
 */
export function canAccessAdminPanel(user: User | null | undefined): boolean {
  return isSuperAdmin(user);
}

/**
 * Check if user can access specific settings pages
 */
export function canAccessSettings(
  user: User | null | undefined,
  settingType: 'twilio' | 'freepbx' | 'openai' | 'account' | 'preferences'
): boolean {
  // If they can't use the core app, they shouldn't be using settings pages (except FreePBX Manager page which is separate)
  if (!canUseApp(user)) {
    return false;
  }

  // Regular users can only access account and preferences
  if (!isAdmin(user)) {
    return settingType === 'account' || settingType === 'preferences';
  }
  
  // Admins can access all settings
  return true;
}

/**
 * Get allowed menu items for user based on their role
 */
export function getAllowedMenuItems(user: User | null | undefined) {
  const baseItems = canUseApp(user)
    ? [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/call-history', label: 'Calls' },
      ]
    : [];

  const userSettings = canUseApp(user)
    ? [
        { href: '/settings/account', label: 'Account Settings' },
        { href: '/settings/preferences', label: 'Preferences' },
      ]
    : [];

  const adminSettings = [
    { href: '/settings/twilio', label: 'Twilio Call Settings' },
    { href: '/settings/freepbx', label: 'FreePBX Integration' },
    { href: '/settings/openai', label: 'OpenAI Integration' },
  ];

  const adminItems = [
    { href: '/admin', label: 'User Management' },
  ];

  const settingsItems = isAdmin(user)
    ? [...userSettings, ...adminSettings]
    : userSettings;

  return {
    baseItems,
    settingsItems,
    adminItems: isSuperAdmin(user) ? adminItems : [],
  };
}

