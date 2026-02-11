'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard,
  Settings,
  LogOut,
  ChevronDown,
  User,
  Sliders,
  PhoneCall,
  ServerCog,
  History,
  Brain,
  Shield,
  Users,
  Search,
  CreditCard,
  Inbox,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import styles from './Sidebar.module.css'
import { useUser } from '@/hooks/use-user'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { useAllUsers } from '@/hooks/use-admin'
import { canUseApp, canUseFreepbxManager, isSuperAdmin } from '@/lib/permissions'

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { data: currentUser } = useUser()
  const { selectedUserId, selectedUserEmail, isViewingAsAdmin, selectUser, clearSelection } = useAdminUser()
  const { data: allUsers } = useAllUsers({ enabled: isSuperAdmin(currentUser) })
  
  const [settingsExpanded, setSettingsExpanded] = useState(pathname?.startsWith('/settings'))
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard'
    }
    if (path === '/call-history') {
      return pathname === '/call-history' || pathname?.startsWith('/call-history/')
    }
    if (path === '/billing') {
      return pathname === '/billing' || pathname?.startsWith('/billing/')
    }
    if (path === '/admin') {
      return pathname === '/admin' || pathname?.startsWith('/admin/')
    }
    if (path.startsWith('/settings')) {
      return pathname === path
    }
    return false
  }

  const baseMenuItems = canUseApp(currentUser)
    ? [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/call-history', label: 'Calls', icon: History },
        ...(isSuperAdmin(currentUser) ? [{ href: '/voicemail', label: 'Voicemail', icon: Inbox }] : []),
      ]
    : []

  const menuItems = baseMenuItems

  const allSettingsItems = [
    { href: '/admin', label: 'User Management', icon: Users, visible: () => isSuperAdmin(currentUser) },
    { href: '/settings/account', label: 'Account Settings', icon: User, visible: () => canUseApp(currentUser) },
    { href: '/billing', label: 'Billing', icon: CreditCard, visible: () => canUseApp(currentUser) },
    { href: '/settings/preferences', label: 'Preferences', icon: Sliders, visible: () => canUseApp(currentUser) },
    { href: '/settings/twilio', label: 'Twilio Call Settings', icon: PhoneCall, visible: () => isSuperAdmin(currentUser) },
    { href: '/settings/freepbx', label: 'FreePBX Integration', icon: ServerCog, visible: () => isSuperAdmin(currentUser) },
    { href: '/settings/freepbx/extensions', label: 'Extensions', icon: Search, visible: () => isSuperAdmin(currentUser) },
    { href: '/settings/openai', label: 'OpenAI Integration', icon: Brain, visible: () => isSuperAdmin(currentUser) },
    { href: '/settings/system', label: 'System Monitor', icon: ServerCog, visible: () => isSuperAdmin(currentUser) },
    { href: '/settings/freepbx/user-manager', label: 'FreePBX Manager', icon: Users, visible: () => canUseFreepbxManager(currentUser) },
  ]

  const settingsSubItems = allSettingsItems.filter((item) => item.visible())

  // Filter users for search
  const filteredUsers = allUsers?.filter(user => 
    user.email.toLowerCase().includes(userSearchQuery.toLowerCase())
  ) || []

  // Get display info for current/selected user
  const displayEmail = isViewingAsAdmin ? selectedUserEmail : (session?.user?.email || 'User')
  const getNameCompanyLabel = (fullName?: string, companyName?: string) => {
    const name = (fullName || '').trim()
    const company = (companyName || '').trim()
    if (name && company) return `${name} (${company})`
    if (name) return name
    if (company) return company
    return ''
  }

  const selectedUserProfile = isViewingAsAdmin
    ? allUsers?.find((u) => u.id === selectedUserId)
    : undefined

  const displayNameLine = isViewingAsAdmin
    ? getNameCompanyLabel(selectedUserProfile?.fullName, selectedUserProfile?.companyName) || displayEmail
    : getNameCompanyLabel(currentUser?.fullName, currentUser?.companyName) || displayEmail

  const displaySubLine = displayEmail

  const handleUserClick = () => {
    if (isSuperAdmin(currentUser)) {
      setUserDropdownOpen(!userDropdownOpen)
    }
  }

  const handleSelectUser = (userId: string, email: string) => {
    selectUser(userId, email)
    setUserDropdownOpen(false)
    setUserSearchQuery('')
  }

  const handleBackToYourAccount = () => {
    clearSelection()
    setUserDropdownOpen(false)
    setUserSearchQuery('')
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarLogo}>
          <img src="/wisecall-logo.png" alt="WiseCall" className={styles.sidebarLogoImg} />
        </div>
      </div>

      <nav className={styles.sidebarNav}>
        {menuItems.map((item) => {
          const active = isActive(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${active ? styles.active : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className={styles.navIcon} size={18} strokeWidth={1.8} />
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          )
        })}

        {/* Settings with Submenu */}
        <div className={styles.navItemWithSubmenu}>
          <button
            className={`${styles.navItem} ${pathname?.startsWith('/settings') ? styles.active : ''}`}
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            type="button"
          >
            <Settings className={styles.navIcon} size={18} strokeWidth={1.8} />
            <span className={styles.navLabel}>Settings</span>
            <ChevronDown 
              className={`${styles.chevronIcon} ${settingsExpanded ? styles.chevronExpanded : ''}`} 
              size={16} 
              strokeWidth={2}
            />
          </button>
          
          <div className={`${styles.submenu} ${settingsExpanded ? styles.submenuExpanded : ''}`}>
            {settingsSubItems.map((item) => {
              const active = isActive(item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.submenuItem} ${active ? styles.active : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className={styles.navIcon} size={16} strokeWidth={1.8} />
                  <span className={styles.navLabel}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      <div className={styles.sidebarFooter}>
        <div className={styles.userSelectorWrapper} ref={dropdownRef}>
          <div 
            className={`${styles.userInfo} ${isSuperAdmin(currentUser) ? styles.userInfoClickable : ''} ${isViewingAsAdmin ? styles.userInfoAdmin : ''}`}
            onClick={handleUserClick}
            role={isSuperAdmin(currentUser) ? 'button' : undefined}
            tabIndex={isSuperAdmin(currentUser) ? 0 : undefined}
          >
            <div className={styles.userAvatar}>
              {isViewingAsAdmin && <Shield size={14} className={styles.adminBadge} />}
              {displayEmail?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className={styles.userDetails}>
              <div className={styles.userEmail}>{displayNameLine}</div>
              <div className={styles.userRole}>
                {displaySubLine}
              </div>
            </div>
            {isSuperAdmin(currentUser) && (
              <ChevronDown 
                className={`${styles.userChevron} ${userDropdownOpen ? styles.chevronExpanded : ''}`} 
                size={16} 
              />
            )}
          </div>

          {/* User Dropdown for Admins */}
          {isSuperAdmin(currentUser) && userDropdownOpen && (
            <div className={styles.userDropdown}>
              {/* Back to your account option */}
              {isViewingAsAdmin && (
                <>
                  <button
                    className={styles.userDropdownItem}
                    onClick={handleBackToYourAccount}
                  >
                    <Shield size={14} />
                    <span>Back to Your Account</span>
                  </button>
                  <div className={styles.userDropdownDivider} />
                </>
              )}

              {/* Search */}
              <div className={styles.userDropdownSearch}>
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {/* User list */}
              <div className={styles.userDropdownList}>
                {filteredUsers.length === 0 ? (
                  <div className={styles.userDropdownEmpty}>No users found</div>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      className={`${styles.userDropdownItem} ${selectedUserId === user.id ? styles.selected : ''}`}
                      onClick={() => handleSelectUser(user.id, user.email)}
                    >
                      <div className={styles.userDropdownAvatar}>
                        {user.email.charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.userDropdownDetails}>
                        <div className={styles.userDropdownEmail}>
                          {getNameCompanyLabel(user.fullName, user.companyName) || user.email}
                        </div>
                        <div className={styles.userDropdownPlan}>
                          {user.email}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button
          className={styles.logoutBtn}
          onClick={() => signOut({ callbackUrl: '/login' })}
          title="Sign out"
          type="button"
        >
          <LogOut className={styles.navIcon} size={18} strokeWidth={1.8} />
          <span className={styles.navLabel}>Sign out</span>
        </button>
      </div>
    </div>
  )
}
