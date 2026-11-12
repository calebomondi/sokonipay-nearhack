import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from './supabase'
import { Button, Spinner } from './ui'

type Auth = { session: Session | null; signInWithGoogle: (next?: string) => Promise<void>; signOut: () => Promise<void> }
const Ctx = createContext<Auth | null>(null)
const NEXT_KEY = 'sokoni.next'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<Auth>(
    () => ({
      session,
      signInWithGoogle: async (next) => {
        // Remember where the person was headed (a shop's code, a split-bill link) across the Google round trip.
        sessionStorage.setItem(NEXT_KEY, next ?? location.pathname + location.search)
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          // Always show Google's account chooser, so a person can switch accounts after signing out.
          options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
        })
        if (error) throw error
      },
      signOut: async () => {
        // 'local' ends this site's session only. The default ends every session of the account, on the other SokoniPay site too.
        await supabase.auth.signOut({ scope: 'local' })
      },
    }),
    [session],
  )

  if (loading) return <FullPage><Spinner /></FullPage>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const auth = useContext(Ctx)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}

export function FullPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">{children}</div>
}

// A code can be exchanged once. React runs effects twice in development, so both runs share one exchange.
const exchanges = new Map<string, Promise<string | null>>()
function exchange(code: string) {
  let pending = exchanges.get(code)
  if (!pending) {
    pending = supabase.auth.exchangeCodeForSession(code).then(({ error }) => error?.message ?? null)
    exchanges.set(code, pending)
  }
  return pending
}

/** Where Google returns: swap ?code= for a session, then go where the person was headed. */
export function AuthCallback() {
  const navigate = useNavigate()
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const url = new URL(location.href)
      const code = url.searchParams.get('code')
      const refused = url.searchParams.get('error_description') ?? new URLSearchParams(url.hash.slice(1)).get('error_description')
      const exchangeError = code ? await exchange(code) : null
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (!data.session) return setFailure(refused ?? exchangeError ?? 'That sign-in didn’t complete.')
      const next = sessionStorage.getItem(NEXT_KEY)
      sessionStorage.removeItem(NEXT_KEY)
      navigate(next && next.startsWith('/') && !next.startsWith('/auth') ? next : '/', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (!failure) return <FullPage><Spinner /><p className="text-soft">Signing you in…</p></FullPage>
  return (
    <FullPage>
      <h1 className="text-2xl font-bold">Sign-in didn’t finish</h1>
      <p className="max-w-sm text-soft">{failure}</p>
      <Button onClick={() => navigate('/', { replace: true })}>Try again</Button>
    </FullPage>
  )
}

export function GoogleButton({ next }: { next?: string }) {
  const { signInWithGoogle } = useAuth()
  const [error, setError] = useState('')
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => signInWithGoogle(next).catch((e) => setError(String(e.message ?? e)))}
        className="flex items-center gap-3 rounded-full bg-ink px-6 py-3.5 text-base font-semibold text-white hover:bg-black"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
        </svg>
        Continue with Google
      </button>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  )
}
