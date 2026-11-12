import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useSearchParams } from 'react-router'
import { api, ApiError, type Me } from '@shared/api'
import { AuthCallback, FullPage, GoogleButton, useAuth } from '@shared/auth'
import { Button, Notice, Spinner, Logo } from '@shared/ui'
import Home from './Home'
import Join from './Join'
import ReceiptPage from './ReceiptPage'
import ShopPage from './ShopPage'

export default function App() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/r/:id" element={<ReceiptPage />} />
      <Route path="*" element={<SignedIn />} />
    </Routes>
  )
}

/** A shop's code opens /pay?m=<shop>, with &p=<table code> at a stall or &c=<amount> at a counter. */
function FromCode() {
  const [q] = useSearchParams()
  const shop = q.get('m')
  const extra = q.get('p') ? `?p=${q.get('p')}` : q.get('c') ? `?c=${q.get('c')}` : ''
  return <Navigate replace to={shop ? `/shop/${shop}${extra}` : '/'} />
}

function SignedIn() {
  const { session, signOut } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setError('')
    api<Me>('/api/me').then(setMe).catch((e) => {
      // A session the server no longer accepts: drop it, so the person lands on the sign-in page.
      if (e instanceof ApiError && e.status === 401) void signOut()
      else setError(e.message)
    })
  }, [signOut])
  useEffect(() => {
    if (session) load()
    else setMe(null)
  }, [session, load])

  if (!session) return <Welcome />
  if (error) return <FullPage><Notice>{error}</Notice><Button onClick={load}>Try again</Button></FullPage>
  if (!me) return <FullPage><Spinner /></FullPage>
  if (!me.customer?.ready) return <Setup name={me.user.name} onDone={load} />
  return (
    <Routes>
      <Route path="/pay" element={<FromCode />} />
      <Route path="/shop/:id" element={<ShopPage />} />
      <Route path="/join/:orderId" element={<Join />} />
      {/* Home, /tickets, /shops and /activity are one screen with tabs, so its data loads once. */}
      <Route path="/:tab?" element={<Home hasShop={!!me.merchant?.ready} />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}

function Welcome() {
  return (
    <main className="mx-auto flex panel w-full max-w-md flex-col px-6 pb-10 pt-8">
      <Logo size={44} />
      <div className="flex flex-1 flex-col justify-center gap-6 py-10">
        <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight">Your agent pays the shop’s agent.</h1>
        <p className="text-lg text-soft">
          Say what you want. Your agent checks the shop is real, agrees a price and pays in stablecoins on NEAR. It can only spend
          inside limits you set.
        </p>
        <ul className="space-y-3 text-sm">
          {[
            ['Limits it can’t break', 'A per-payment and a daily limit live in the NEAR contract. Your agent’s key can pay invoices and nothing else.'],
            ['No fake stickers', 'Your agent connects only to shops on the onchain register of verified shops.'],
            ['Split a bill by link', 'Each friend’s agent pays its share. The shop is paid once, when the last share lands.'],
          ].map(([h, p]) => (
            <li key={h} className="rounded-2xl bg-card p-4">
              <p className="font-semibold">{h}</p>
              <p className="mt-0.5 text-soft">{p}</p>
            </li>
          ))}
        </ul>
      </div>
      <GoogleButton />
      <p className="mt-4 text-center text-xs text-soft">
        A demo on NEAR testnet. Signing in creates a NEAR account that SokoniPay holds for you, with play money worth 50 dollars.
      </p>
    </main>
  )
}

const STEPS = ['Creating your NEAR account', 'Adding demo money', 'Setting your agent’s spending limits', 'Giving your agent its key']

/** First sign-in. The backend does four things onchain; this takes about 20 seconds. */
function Setup({ name, onDone }: { name: string | null; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setError('')
    setStep(0)
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4500)
    api('/api/me/customer', { method: 'POST' })
      .then(() => live && onDone())
      .catch((e) => live && setError(e.message))
      .finally(() => clearInterval(tick))
    return () => {
      live = false
      clearInterval(tick)
    }
  }, [attempt, onDone])

  return (
    <FullPage>
      <h1 className="text-3xl font-extrabold tracking-tight">Welcome{name ? `, ${name.split(' ')[0]}` : ''}</h1>
      <p className="max-w-xs text-soft">Setting up your account on NEAR. This takes about 20 seconds and happens once.</p>
      <ol className="w-full max-w-xs space-y-2 text-left text-sm">
        {STEPS.map((s, n) => (
          <li key={s} className={`flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ${n > step ? 'text-soft' : ''}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${n < step ? 'bg-good text-white' : n === step && !error ? 'bg-iris text-white' : 'bg-fill'}`}>
              {n < step ? '✓' : n + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      {error ? (
        <>
          <Notice>{error}</Notice>
          <Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
        </>
      ) : (
        <Spinner />
      )}
    </FullPage>
  )
}
