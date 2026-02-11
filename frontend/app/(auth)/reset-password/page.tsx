'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/auth'

type Stage = 'loading' | 'ready' | 'no_token' | 'error' | 'success'

function parseHashParams(hash: string): Record<string, string> {
  const raw = (hash || '').replace(/^#/, '')
  const params = new URLSearchParams(raw)
  const out: Record<string, string> = {}
  params.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const urlInfo = useMemo(() => {
    if (typeof window === 'undefined') return { hasCode: false, code: '', hash: {} as Record<string, string> }
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code') || ''
    const hash = parseHashParams(window.location.hash || '')
    return { hasCode: Boolean(code), code, hash }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initRecoverySession() {
      try {
        if (!supabase) {
          setStage('error')
          setError('Supabase not configured')
          return
        }

        // Newer Supabase flows can send `?code=...` (PKCE). Handle that first.
        if (urlInfo.hasCode) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(window.location.href)
          if (exErr) {
            setStage('error')
            setError(exErr.message)
            return
          }
          if (!cancelled) setStage('ready')
          return
        }

        // Older/implicit recovery links often include tokens in the URL hash:
        // #access_token=...&refresh_token=...&type=recovery
        const access_token = urlInfo.hash['access_token']
        const refresh_token = urlInfo.hash['refresh_token']
        const type = urlInfo.hash['type']

        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
          if (setErr) {
            setStage('error')
            setError(setErr.message)
            return
          }
          if (!cancelled) setStage('ready')
          return
        }

        // If we reached here, there is no usable recovery token.
        // Note: some links may include only `type=recovery` in the hash without tokens.
        if (type === 'recovery') {
          setStage('error')
          setError('Recovery link is missing session tokens. Please request a new reset email.')
          return
        }

        setStage('no_token')
      } catch (err: any) {
        setStage('error')
        setError(err?.message || 'Failed to initialize password reset')
      }
    }

    initRecoverySession()
    return () => {
      cancelled = true
    }
  }, [urlInfo.hasCode, urlInfo.code, urlInfo.hash])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!supabase) {
      setError('Supabase not configured')
      return
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
      if (updateErr) {
        setError(updateErr.message)
        return
      }

      // Optional: sign out the recovery session so user logs in fresh.
      await supabase.auth.signOut()
      setStage('success')
    } catch (err: any) {
      setError(err?.message || 'Failed to update password')
    } finally {
      setSaving(false)
    }
  }

  if (stage === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
          <h2 className="text-2xl font-bold text-center">Reset password</h2>
          <p className="text-center text-sm text-gray-600">Loading…</p>
        </div>
      </div>
    )
  }

  if (stage === 'no_token') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
          <h2 className="text-2xl font-bold text-center">Reset password</h2>
          <p className="text-center text-sm text-gray-600">
            This page is only available from a valid password reset link.
          </p>
          <a
            href="/forgot-password"
            className="w-full inline-flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Request a reset link
          </a>
          <div className="text-center">
            <a href="/login" className="text-sm text-indigo-600 hover:text-indigo-900">
              Back to login
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
          <h2 className="text-2xl font-bold text-center">Password updated</h2>
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded text-sm">
            Your password has been updated. Please sign in with your new password.
          </div>
          <a
            href="/login"
            className="w-full inline-flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Go to login
          </a>
        </div>
      </div>
    )
  }

  // stage: ready OR error (but still show form; error is displayed)
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-3xl font-bold text-center">Set a new password</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Choose a new password for your account.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                New password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                autoComplete="new-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Updating...' : 'Update password'}
          </button>

          <div className="text-center">
            <a href="/login" className="text-sm text-indigo-600 hover:text-indigo-900">
              Back to login
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}

