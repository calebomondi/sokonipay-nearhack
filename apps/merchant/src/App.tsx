import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { api, ApiError, type Me } from '@shared/api'
import { AuthCallback, FullPage, GoogleButton, useAuth } from '@shared/auth'
import { Button, Notice, Spinner } from '@shared/ui'
import Admin from './Admin'
import Console from './Console'
import OpenShop from './OpenShop'
import Statement from './Statement'

export default function App() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<SignedIn />} />
    </Routes>
  )
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
  return (
    <Routes>
      <Route path="/admin" element={me.is_admin ? <Admin /> : <FullPage><Notice>This page is for SokoniPay admins.</Notice></FullPage>} />
      <Route path="/" element={me.merchant?.ready ? <Console isAdmin={me.is_admin} /> : <OpenShop resume={!!me.merchant} isAdmin={me.is_admin} onDone={load} />} />
      {me.merchant?.ready && <Route path="/statement" element={<Statement />} />}
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}

function Welcome() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-10 px-6 py-10 lg:grid-cols-2">
      <div className="space-y-6">
        <p className="text-lg font-bold">SokoniPay <span className="font-medium text-soft">for shops</span></p>
        <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight lg:text-6xl">An agent that runs your gate or your till.</h1>
        <p className="max-w-md text-lg text-soft">
          Customers scan one code, their agent pays yours, and they hold a ticket or a receipt. Nobody queues to read out a phone
          number, and a failed payment is retried on the spot.
        </p>
        <GoogleButton />
        <p className="text-xs text-soft">A demo on NEAR testnet. Signing in creates a NEAR account for your shop that SokoniPay holds for you.</p>
      </div>
      <ul className="space-y-3">
        {[
          ['Set it up yourself', 'Name your venue or stall, list your tickets or menu with your own prices, and set your hours.'],
          ['One code at the gate', 'It identifies you, not a payment. Customers get it only after SokoniPay has verified your shop on NEAR.'],
          ['Tickets that expire at closing', 'A ticket covers everyone it was bought for and stops working when you close. The contract refuses a used or expired one.'],
          ['Every sale splits itself', 'Send a share to savings or a partner. The contract divides each payment in the same transaction.'],
        ].map(([h, p]) => (
          <li key={h} className="rounded-3xl bg-card p-5">
            <p className="font-semibold">{h}</p>
            <p className="mt-1 text-sm text-soft">{p}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
