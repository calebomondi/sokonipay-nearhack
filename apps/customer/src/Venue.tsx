import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, stream, type Ev } from '@shared/api'
import { Button, Card, Notice, VerifiedLine, fmt } from '@shared/ui'
import type { Shop } from './ShopPage'
import { Plans } from './Subs'
import { Transcript } from './Transcript'

/** A gate: pick how many of each ticket, your agent gets the invoice and pays, you get the ticket. */
export default function Venue({ shop }: { shop: Shop }) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const [events, setEvents] = useState<Ev[]>([])
  const [running, setRunning] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const [gate, setGate] = useState({ open: shop.open, says: shop.gate_says })

  // The gate can close while this page is open.
  useEffect(() => {
    const t = setInterval(() => {
      api<Shop>(`/api/shops/${shop.near_id}`).then((s) => setGate({ open: s.open, says: s.gate_says })).catch(() => {})
    }, 30_000)
    return () => clearInterval(t)
  }, [shop.near_id])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  const picked = shop.items.filter((i) => (qty[i.sku] ?? 0) > 0)
  const people = picked.reduce((n, i) => n + qty[i.sku], 0)
  const total = picked.reduce((n, i) => n + qty[i.sku] * i.price, 0)
  const gotTicket = events.some((e) => e.t === 'receipt')

  async function buy() {
    // The ref locks at once; `running` only changes on the next render, which a second tap can beat.
    if (!people || busy.current) return
    busy.current = true
    setRunning(true)
    setEvents([])
    try {
      await stream<Ev>('/api/orders', {
        shop: shop.near_id, goal: picked.map((i) => `${qty[i.sku]} × ${i.name}`).join(', '),
        items: picked.map((i) => ({ sku: i.sku, qty: qty[i.sku] })),
      }, (e) => setEvents((all) => [...all, e]))
      setQty({})
    } catch (e) {
      setEvents((all) => [...all, { t: 'error', text: (e as Error).message }])
    } finally {
      busy.current = false
      setRunning(false)
    }
  }

  return (
    <main className="mx-auto flex panel w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5">
      <Link to="/" className="w-fit rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">Back</Link>
      <header className="space-y-2">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight">{shop.name}</h1>
        {shop.verified ? <VerifiedLine id={shop.near_id} /> : <Notice>{shop.near_id} is not a verified venue. Your agent won’t pay it.</Notice>}
        <p className="text-sm text-soft">
          {shop.place}{shop.place && shop.hours ? '. ' : ''}{shop.hours ? `Open ${shop.hours.open} to ${shop.hours.close}.` : ''}
        </p>
      </header>

      {!gate.open && <Notice tone="plain">{gate.says} Tickets are sold while the gate is open.</Notice>}

      {events.length > 0 && <Transcript events={events} running={running} shop={shop} />}
      <div ref={end} />

      {!running && shop.verified && gate.open && (
        <Card className="space-y-4">
          <h2 className="text-lg font-bold">{gotTicket ? 'Buy more tickets' : 'How many tickets?'}</h2>
          <ul className="divide-y divide-line">
            {shop.items.map((i) => {
              const n = qty[i.sku] ?? 0
              return (
                <li key={i.sku} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-semibold">{i.name}</span>
                    <span className="num text-sm text-soft">{fmt(i.price)} each</span>
                  </span>
                  <div className="flex items-center gap-1 rounded-full bg-fill p-1">
                    <button type="button" aria-label={`One fewer ${i.name}`} disabled={n <= 0} onClick={() => setQty({ ...qty, [i.sku]: n - 1 })} className="h-9 w-9 rounded-full bg-card text-lg font-semibold disabled:opacity-40">−</button>
                    <span className="num w-8 text-center font-semibold" aria-live="polite">{n}</span>
                    <button type="button" aria-label={`One more ${i.name}`} disabled={n >= 20} onClick={() => setQty({ ...qty, [i.sku]: n + 1 })} className="h-9 w-9 rounded-full bg-card text-lg font-semibold disabled:opacity-40">+</button>
                  </div>
                </li>
              )
            })}
          </ul>
          {shop.items.length === 0 && <p className="text-sm text-soft">This venue hasn’t listed its tickets yet.</p>}
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm text-soft">{people ? `${people} ${people === 1 ? 'person' : 'people'}` : 'Total'}</span>
            <span className="num text-2xl font-extrabold tracking-tight">{fmt(total)}</span>
          </div>
          <Button disabled={!people} onClick={buy} className="w-full">
            {people ? `Get ${people === 1 ? 'my ticket' : `${people} tickets`}` : 'Pick your tickets'}
          </Button>
          <p className="text-xs text-soft">
            Your agent asks the venue’s agent for an invoice, checks it and pays. One ticket covers everyone you picked, and works until closing time today.
          </p>
        </Card>
      )}
      {!running && <Plans plans={shop.plans} shop={shop.name} />}
    </main>
  )
}
