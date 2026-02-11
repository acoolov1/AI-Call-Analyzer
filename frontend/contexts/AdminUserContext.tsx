'use client'

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'

interface AdminUserContextType {
  selectedUserId: string | null
  selectedUserEmail: string | null
  isViewingAsAdmin: boolean
  selectUser: (userId: string, email: string) => void
  clearSelection: () => void
}

const AdminUserContext = createContext<AdminUserContextType | undefined>(undefined)

const STORAGE_KEY = 'wisecall:selectedUser'

export function AdminUserProvider({ children }: { children: ReactNode }) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null)

  // Persist "view as user" selection across full page refreshes.
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
      if (!raw) return
      const parsed = JSON.parse(raw)
      const id = typeof parsed?.id === 'string' ? parsed.id : null
      const email = typeof parsed?.email === 'string' ? parsed.email : null
      if (id) {
        setSelectedUserId(id)
        setSelectedUserEmail(email)
      }
    } catch {
      // ignore
    }
  }, [])

  const selectUser = useCallback((userId: string, email: string) => {
    setSelectedUserId(userId)
    setSelectedUserEmail(email)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: userId, email }))
      }
    } catch {
      // ignore
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedUserId(null)
    setSelectedUserEmail(null)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // ignore
    }
  }, [])

  const isViewingAsAdmin = selectedUserId !== null

  return (
    <AdminUserContext.Provider
      value={{
        selectedUserId,
        selectedUserEmail,
        isViewingAsAdmin,
        selectUser,
        clearSelection,
      }}
    >
      {children}
    </AdminUserContext.Provider>
  )
}

export function useAdminUser() {
  const context = useContext(AdminUserContext)
  if (context === undefined) {
    throw new Error('useAdminUser must be used within AdminUserProvider')
  }
  return context
}

