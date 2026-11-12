import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local')

// PKCE: Google returns to /auth/callback with ?code=, which that page exchanges itself.
// detectSessionInUrl is off so the code is never exchanged twice.
export const supabase = createClient(url, anonKey, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
})

/** The signed-in user's access token, refreshed first if it is about to expire. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) return null
  if ((session.expires_at ?? 0) * 1000 - Date.now() < 60_000) {
    const fresh = await supabase.auth.refreshSession()
    return fresh.error ? null : (fresh.data.session?.access_token ?? null)
  }
  return session.access_token
}
