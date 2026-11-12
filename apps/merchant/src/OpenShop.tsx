import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@shared/api'
import { FullPage, useAuth } from '@shared/auth'
import { Button, Notice, Spinner } from '@shared/ui'

type Kind = 'venue' | 'food' | 'counter'
type Row = { name: string; price: string; category: string }
const STEPS = ['Creating your shop’s NEAR account', 'Putting it on the onchain register', 'Setting your agent’s limits', 'Giving your agent its key']
const KINDS: { kind: Kind; title: string; text: string }[] = [
  { kind: 'venue', title: 'A park, venue or event', text: 'You sell entry tickets at a gate. Tickets work until you close for the day.' },
  { kind: 'food', title: 'A food stall or kitchen', text: 'You sell from a menu. Customers’ agents order and can ask for a better price.' },
  { kind: 'counter', title: 'A counter or till', text: 'You key in each amount: a petrol station, kiosk, barber or general shop.' },
]

/** The owner sets the shop up themselves: what it is, when it opens, what it sells and for how much. */
export default function OpenShop({ resume, isAdmin, onDone }: { resume: boolean; isAdmin: boolean; onDone: () => void }) {
  const { signOut } = useAuth()
  const [kind, setKind] = useState<Kind | null>(null)
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [open, setOpen] = useState('06:00')
  const [close, setClose] = useState('18:30')
  const [rows, setRows] = useState<Row[]>([{ name: '', price: '', category: 'main' }])
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')

  const send = useCallback(async (path: string, body?: unknown) => {
    setBusy(true)
    setError('')
    setStep(0)
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 5000)
    try {
      await api(path, { method: 'POST', body })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    } finally {
      clearInterval(tick)
    }
  }, [onDone])

  // A setup that stopped half-way picks up where it left off.
  useEffect(() => {
    if (resume) void send('/api/shop/resume')
  }, [resume, send])

  if (busy) {
    return (
      <FullPage>
        <h1 className="text-3xl font-extrabold tracking-tight">Opening your shop</h1>
        <p className="max-w-xs text-soft">This takes about 25 seconds and happens once.</p>
        <ol className="w-full max-w-sm space-y-2 text-left text-sm">
          {STEPS.map((s, n) => (
            <li key={s} className={`flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ${n > step ? 'text-soft' : ''}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${n < step ? 'bg-good text-white' : n === step ? 'bg-iris text-white' : 'bg-fill'}`}>{n < step ? '✓' : n + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <Spinner />
      </FullPage>
    )
  }

  const footer = (
    <p className="flex justify-center gap-4 text-sm text-soft">
      <button type="button" onClick={signOut} className="hover:underline">Sign out</button>
      {isAdmin && <Link to="/admin" className="hover:underline">Admin</Link>}
    </p>
  )

  if (resume) return <FullPage><Notice>{error || 'Your shop setup didn’t finish.'}</Notice><Button onClick={() => send('/api/shop/resume')}>Finish setting up</Button>{footer}</FullPage>

  if (!kind) {
    return (
      <FullPage>
        <div className="w-full max-w-3xl space-y-5 text-left">
          <h1 className="text-4xl font-extrabold tracking-tight">What are you opening?</h1>
          <div className="grid gap-3 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button key={k.kind} onClick={() => { setKind(k.kind); setRows([{ name: '', price: '', category: 'main' }]) }} className="rounded-3xl bg-card p-6 text-left ring-iris hover:ring-2">
                <span className="block text-xl font-bold">{k.title}</span>
                <span className="mt-1 block text-sm text-soft">{k.text}</span>
              </button>
            ))}
          </div>
          {footer}
        </div>
      </FullPage>
    )
  }

  const venue = kind === 'venue'
  const counter = kind === 'counter'
  const filled = rows.filter((r) => r.name.trim().length >= 2 && Number(r.price) >= 1)
  const field = 'mt-1 w-full rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  const cell = 'min-w-0 rounded-2xl bg-fill px-3 py-2.5 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  const setRow = (n: number, patch: Partial<Row>) => setRows(rows.map((r, i) => (i === n ? { ...r, ...patch } : r)))

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      <form
        className="space-y-5 rounded-3xl bg-card p-7"
        onSubmit={(e) => {
          e.preventDefault()
          void send('/api/shop', {
            kind, name, place, blurb: '', hours: venue ? { open, close } : null,
            items: counter ? [] : filled.map((r) => ({ name: r.name.trim(), price_kes: Math.round(Number(r.price)), category: r.category })),
          })
        }}
      >
        <div>
          <button type="button" onClick={() => setKind(null)} className="text-sm text-soft hover:underline">Change type</button>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{venue ? 'Set up your venue' : counter ? 'Set up your counter' : 'Set up your stall'}</h1>
        </div>
        <label className="block text-sm font-medium">{venue ? 'Venue name' : counter ? 'Business name' : 'Stall name'}
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={venue ? 'Nairobi Arboretum' : counter ? 'Kilimani Service Station' : 'Mama Njeri’s Kitchen'} maxLength={60} />
        </label>
        <label className="block text-sm font-medium">Where customers find you
          <input className={field} value={place} onChange={(e) => setPlace(e.target.value)} placeholder={venue ? 'State House Road, Nairobi' : counter ? 'Argwings Kodhek Road, Nairobi' : 'Stall 9, Gikomba Market'} maxLength={120} />
        </label>
        {venue && (
          <fieldset>
            <legend className="text-sm font-medium">Gate hours, Nairobi time</legend>
            <div className="mt-1 flex items-center gap-3">
              <input type="time" aria-label="Opens at" className={cell} value={open} onChange={(e) => setOpen(e.target.value)} />
              <span className="text-sm text-soft">to</span>
              <input type="time" aria-label="Closes at" className={cell} value={close} onChange={(e) => setClose(e.target.value)} />
            </div>
            <p className="mt-1.5 text-xs text-soft">A ticket works until closing time on the day it was bought.</p>
          </fieldset>
        )}
        {counter && <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">A counter has no price list. For each sale you key in the amount in shillings, the customer scans your code, and their agent pays it.</p>}
        {!counter && <fieldset>
          <legend className="text-sm font-medium">{venue ? 'Tickets you sell' : 'Your menu'}</legend>
          <ul className="mt-1 space-y-2">
            {rows.map((r, n) => (
              <li key={n} className="flex gap-2">
                <input aria-label="Name" className={`${cell} flex-1`} value={r.name} onChange={(e) => setRow(n, { name: e.target.value })} placeholder={venue ? ['Adult', 'Child', 'Student'][n % 3] : ['Beef pilau', 'Chapati', 'Masala chai'][n % 3]} maxLength={60} />
                {!venue && (
                  <select aria-label="Kind of dish" className={cell} value={r.category} onChange={(e) => setRow(n, { category: e.target.value })}>
                    <option value="main">Main</option><option value="side">Side</option><option value="drink">Drink</option>
                  </select>
                )}
                <input aria-label="Price in shillings" className={`${cell} num w-24 text-right`} inputMode="numeric" value={r.price} onChange={(e) => setRow(n, { price: e.target.value })} placeholder="KES" />
                <button type="button" aria-label="Remove" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== n))} className="rounded-full px-2 text-lg text-soft hover:text-bad disabled:opacity-30">×</button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={rows.length >= 12} onClick={() => setRows([...rows, { name: '', price: '', category: 'main' }])} className="mt-2 text-sm font-semibold text-iris hover:underline">
            Add another
          </button>
          <p className="mt-1.5 text-xs text-soft">Prices are in Kenya shillings. Each sale settles in dollars on NEAR at the day’s rate. You can change these later.</p>
        </fieldset>}
        {error && <Notice>{error}</Notice>}
        <Button disabled={name.trim().length < 2 || (!counter && filled.length === 0)} className="w-full">Open my {venue ? 'venue' : counter ? 'counter' : 'stall'}</Button>
        <p className="text-xs text-soft">After this, SokoniPay checks your shop. Customers can find it, and you get your code, once it is verified.</p>
        {footer}
      </form>
    </main>
  )
}
