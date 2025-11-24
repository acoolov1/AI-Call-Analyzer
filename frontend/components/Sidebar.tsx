'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { LayoutDashboard, Phone, Settings, LogOut, ChevronDown, User, Sliders, PhoneCall, ServerCog } from 'lucide-react'
import { useState } from 'react'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [settingsExpanded, setSettingsExpanded] = useState(pathname?.startsWith('/settings'))

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard'
    }
    if (path === '/calls') {
      return pathname === '/calls' || pathname?.startsWith('/calls/')
    }
    if (path.startsWith('/settings')) {
      return pathname === path
    }
    return false
  }

  const menuItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/calls', label: 'Interactions', icon: Phone },
  ]

  const settingsSubItems = [
    { href: '/settings/account', label: 'Account Settings', icon: User },
    { href: '/settings/preferences', label: 'Preferences', icon: Sliders },
    { href: '/settings/twilio', label: 'Twilio Call Settings', icon: PhoneCall },
    { href: '/settings/freepbx', label: 'FreePBX Integration', icon: ServerCog },
  ]

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarLogo}>📞</div>
        <div className={styles.sidebarTitle}>Call Analysis</div>
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
        <div className={styles.userInfo}>
          <div className={styles.userAvatar}>
            {session?.user?.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className={styles.userDetails}>
            <div className={styles.userEmail}>{session?.user?.email || 'User'}</div>
            <div className={styles.userRole}>Free Plan</div>
          </div>
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
