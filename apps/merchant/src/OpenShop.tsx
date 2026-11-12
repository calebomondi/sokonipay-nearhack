import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@shared/api'
import { FullPage, useAuth } from '@shared/auth'
import { Button, Logo, Notice, ShopIcon, Spinner, Tick } from '@shared/ui'
import { ShopCode } from './ShopCode'

type Kind = 'venue' | 'food' | 'counter'
type Row = { name: string; price: string; category: string }
const STEPS = ['Creating your shop’s NEAR account', 'Putting it on the onchain register', 'Setting your agent’s limits', 'Giving your agent its key']
const KINDS: { kind: Kind; title: string; text: string; icon: string }[] = [
  { kind: 'venue', title: 'A park, venue or event', text: 'You sell entry tickets at a gate. Tickets work until you close for the day.',
    icon: 'M3.5 8A2.5 2.5 0 0 1 6 5.5h12A2.5 2.5 0 0 1 20.5 8v1.6a2.4 2.4 0 0 0 0 4.8V16a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 16v-1.6a2.4 2.4 0 0 0 0-4.8zM14.5 8.4v1.4M14.5 11.9v1.4M14.5 15.4v.6' },
  { kind: 'food', title: 'A food stall or kitchen', text: 'You sell from a menu. Customers’ agents order and can ask for a better price.',
    icon: 'M6 3.5v6a2.5 2.5 0 0 0 5 0v-6M8.5 3.5v17M17 3.5c-1.7 1.2-2.5 3.4-2.5 6v3H17m0-9v17' },
  { kind: 'counter', title: 'A counter or till', text: 'You key in each amount: a petrol station, kiosk, barber or general shop.',
    icon: 'M5 4.5h14v15H5zM8 8h8M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01M8.5 16h.01M12 16h.01M15.5 16h.01' },
]
// Names only, to save typing. Prices are always the owner's own.
const STARTERS: Record<'venue' | 'food', { label: string; rows: Row[] }> = {
  venue: { label: 'Adult, Child, Student', rows: ['Adult', 'Child', 'Student'].map((name) => ({ name, price: '', category: 'main' })) },
  food: { label: 'A main, a side and a drink', rows: [['', 'main'], ['', 'side'], ['', 'drink']].map(([name, category]) => ({ name, price: '', category })) },
}
const WORD = { venue: 'venue', food: 'stall', counter: 'counter' }

/** The owner sets the shop up themselves, in three short steps, seeing it the way a customer will. */
export default function OpenShop({ resume, isAdmin, another, onDone }: {
  resume: boolean; isAdmin: boolean
  /** The person already has a shop and is opening one more. */
  another: boolean
  onDone: (nearId?: string) => void
}) {
  const { signOut } = useAuth()
  const [kind, setKind] = useState<Kind | null>(null)
  const [at, setAt] = useState<'about' | 'sell'>('about')
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [about, setAbout] = useState('')
  const [timed, setTimed] = useState(false)
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
      const made = await api<{ near_id: string }>(path, { method: 'POST', body })
      onDone(made.near_id)
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
      {another ? <Link to="/" className="hover:underline">Back to my shops</Link> : <button type="button" onClick={signOut} className="hover:underline">Sign out</button>}
      {isAdmin && <Link to="/admin" className="hover:underline">Admin</Link>}
    </p>
  )
  if (resume) return <FullPage><Notice>{error || 'Your shop setup didn’t finish.'}</Notice><Button onClick={() => send('/api/shop/resume')}>Finish setting up</Button>{footer}</FullPage>

  if (!kind) {
    return (
      <FullPage>
        <div className="w-full max-w-3xl space-y-6 text-left">
          <Logo size={40}><span className="font-medium text-soft">for shops</span></Logo>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight">{another ? 'What is the new shop?' : 'What are you opening?'}</h1>
            <p className="mt-1 text-soft">Three short steps. You can change everything afterwards.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button key={k.kind} onClick={() => { setKind(k.kind); setAt('about'); setRows([{ name: '', price: '', category: 'main' }]) }} className="flex flex-col items-start rounded-3xl bg-card p-6 text-left ring-iris transition-shadow hover:ring-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fill">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={k.icon} /></svg>
                </span>
                <span className="mt-4 block text-xl font-bold leading-tight">{k.title}</span>
                <span className="mt-1.5 block text-sm text-soft">{k.text}</span>
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
  const named = name.trim().length >= 2
  const last = counter || at === 'sell'
  const stages = counter ? ['Type', 'Name and place'] : ['Type', 'Name and place', venue ? 'Tickets' : 'Menu']
  const now = at === 'about' ? 1 : 2
  const field = 'mt-1 w-full rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  const cell = 'min-w-0 rounded-2xl bg-fill px-3 py-2.5 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  const setRow = (n: number, patch: Partial<Row>) => setRows(rows.map((r, i) => (i === n ? { ...r, ...patch } : r)))
  const submit = () => send('/api/shop', {
    kind, name, place, blurb: about.trim(), hours: venue || timed ? { open, close } : null,
    items: counter ? [] : filled.map((r) => ({ name: r.name.trim(), price_kes: Math.round(Number(r.price)), category: r.category })),
  })
  const shown = name.trim() || (venue ? 'Your venue' : counter ? 'Your business' : 'Your stall')

  return (
    <main className="mx-auto grid w-full max-w-5xl items-start gap-6 px-5 py-10 lg:grid-cols-[1fr_340px]">
      <form className="space-y-5 rounded-3xl bg-card p-7" onSubmit={(e) => { e.preventDefault(); if (last) void submit(); else setAt('sell') }}>
        {/* Where you are. These are steps in order, so they are numbered. */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {stages.map((s, n) => (
            <li key={s} className="flex items-center gap-2">
              {n > 0 && <span className="h-px w-5 bg-line" aria-hidden />}
              <button type="button" disabled={n > now} onClick={() => (n === 0 ? setKind(null) : setAt(n === 1 ? 'about' : 'sell'))}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${n === now ? 'bg-ink text-white' : n < now ? 'text-ink hover:bg-fill' : 'text-soft'}`}>
                <span className="num text-xs">{n + 1}</span>{s}
              </button>
            </li>
          ))}
        </ol>

        {at === 'about' && (
          <>
            <h1 className="text-3xl font-extrabold tracking-tight">Name your {WORD[kind]}</h1>
            <label className="block text-sm font-medium">{venue ? 'Venue name' : counter ? 'Business name' : 'Stall name'}
              <input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={venue ? 'Nairobi Arboretum' : counter ? 'Kilimani Service Station' : 'Mama Njeri’s Kitchen'} maxLength={60} />
            </label>
            <label className="block text-sm font-medium">Where customers find you
              <input className={field} value={place} onChange={(e) => setPlace(e.target.value)} placeholder={venue ? 'State House Road, Nairobi' : counter ? 'Argwings Kodhek Road, Nairobi' : 'Stall 9, Gikomba Market'} maxLength={120} />
            </label>
            <label className="block text-sm font-medium">Who you are and what you offer <span className="font-normal text-soft">(optional)</span>
              <textarea className={`${field} resize-none`} rows={2} maxLength={200} value={about} onChange={(e) => setAbout(e.target.value)} placeholder={venue ? 'A forest park in the city. Walking trails, picnic lawns and over 350 tree species.' : counter ? 'Fuel, a tyre bay and a small shop, open late.' : 'Home-style Kenyan lunches, cooked fresh every morning.'} />
            </label>
            {!venue && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="h-4 w-4 accent-[var(--color-iris)]" />
                Show opening hours on my page
              </label>
            )}
            {(venue || timed) && (
              <fieldset>
                <legend className="text-sm font-medium">{venue ? 'Gate hours' : 'Opening hours'}, Nairobi time</legend>
                <div className="mt-1 flex items-center gap-3">
                  <input type="time" aria-label="Opens at" className={cell} value={open} onChange={(e) => setOpen(e.target.value)} />
                  <span className="text-sm text-soft">to</span>
                  <input type="time" aria-label="Closes at" className={cell} value={close} onChange={(e) => setClose(e.target.value)} />
                </div>
                {venue && <p className="mt-1.5 text-xs text-soft">A ticket works until closing time on the day it was bought.</p>}
              </fieldset>
            )}
            {counter && <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">A counter has no price list. For each sale you key in the amount in shillings, the customer scans your code, and their agent pays it.</p>}
          </>
        )}

        {at === 'sell' && !counter && (
          <fieldset>
            <legend className="text-3xl font-extrabold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>{venue ? 'Tickets you sell' : 'Your menu'}</legend>
            {rows.every((r) => !r.name && !r.price) && (
              <button type="button" onClick={() => setRows(STARTERS[kind as 'venue' | 'food'].rows)} className="mt-3 rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">
                Start with rows for: {STARTERS[kind as 'venue' | 'food'].label}
              </button>
            )}
            <ul className="mt-3 space-y-2">
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
            <button type="button" disabled={rows.length >= 12} onClick={() => setRows([...rows, { name: '', price: '', category: 'main' }])} className="mt-2 text-sm font-semibold text-iris hover:underline">Add another</button>
            <p className="mt-1.5 text-xs text-soft">Prices are in Kenya shillings. Each sale settles in dollars on NEAR at the day’s rate. A row needs a name and a price to count.</p>
          </fieldset>
        )}

        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="button" tone="quiet" onClick={() => (at === 'sell' ? setAt('about') : setKind(null))}>Back</Button>
          <Button disabled={!named || (at === 'sell' && filled.length === 0)} className="flex-1">
            {last ? `Open my ${WORD[kind]}` : `Next: ${venue ? 'tickets' : 'menu'}`}
          </Button>
        </div>
        {last && <p className="text-xs text-soft">After this, SokoniPay checks your shop. Customers can find it, and your code works, once it is verified.</p>}
        {footer}
      </form>

      {/* What a customer will see, filling in as the owner types. */}
      <aside className="space-y-3 lg:sticky lg:top-8" aria-label="How customers will see your shop">
        <p className="px-1 text-sm font-medium text-soft">How customers will see it</p>
        <div className="rounded-[28px] bg-card p-5 shadow-[0_18px_40px_rgb(12_14_18/0.08)]">
          <div className="flex items-center gap-3">
            <ShopIcon name={shown} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold"><span className="truncate">{shown}</span><Tick /></p>
              <p className="text-sm text-soft">{venue ? 'Park or venue' : counter ? 'Pay at the counter' : 'Food and drink'}</p>
            </div>
          </div>
          {about.trim() && <p className="mt-3 text-sm leading-relaxed">{about.trim()}</p>}
          <ul className="mt-3 space-y-1.5 text-sm text-soft">
            <li className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z" /></svg>
              <span className="truncate">{place.trim() || 'Where customers find you'}</span>
            </li>
            {(venue || timed) && (
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5v4.8l3 1.8" /></svg>
                Open {open} to {close}
              </li>
            )}
          </ul>
          {!counter && (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {(filled.length ? filled : [{ name: venue ? 'Your first ticket' : 'Your first dish', price: '', category: '' }]).map((r, n) => (
                <li key={n} className={`flex justify-between gap-3 py-2.5 text-sm ${filled.length ? '' : 'text-soft'}`}>
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="num shrink-0">{r.price ? `KES ${Math.round(Number(r.price)).toLocaleString('en-US')}` : 'KES'}</span>
                </li>
              ))}
            </ul>
          )}
          {counter && <p className="mt-3 rounded-2xl bg-canvas px-4 py-3 text-sm text-soft">The amount you key in appears here for the customer to pay.</p>}
          <div className="mt-4 flex items-center gap-4 border-t border-line pt-4">
            <ShopCode value={`https://sokonipay.app/pay?m=${shown.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} name={shown} size={96} />
            <p className="text-xs text-soft">Your own code, in your shop’s colour. It works once SokoniPay has verified you. The checkmark appears then too.</p>
          </div>
        </div>
      </aside>
    </main>
  )
}
