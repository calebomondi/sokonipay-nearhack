import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, stream, type Ev } from '@shared/api'
import { Button, Card, fmt, usd } from '@shared/ui'
import type { Shop } from './ShopPage'
import { Plans } from './Subs'
import { ShopHeader } from './ShopHeader'
import { Transcript } from './Transcript'

type Charge = { id: string; amount: number; amount_kes: number; note: string; taken: boolean }

/** A counter: the cashier keys in the amount, it shows up here, and your agent pays it. */
export default function Counter({ shop }: { shop: Shop & { charges?: Charge[] } }) {
  const [q] = useSearchParams()
  const scanned = q.get('c')
  const [charges, setCharges] = useState<Charge[]>(shop.charges ?? [])
  const [events, setEvents] = useState<Ev[]>([])
  const [running, setRunning] = useState(false)
  const busy = useRef(false)
  const end = useRef<HTMLDivElement>(null)

  // The cashier may key the amount in after this page is open.
  useEffect(() => {
    const t = setInterval(() => {
      api<{ charges: Charge[] }>(`/api/shops/${shop.near_id}`).then((s) => setCharges(s.charges)).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [shop.near_id])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  const paid = events.some((e) => e.t === 'receipt')
  // The amount on the code that was scanned comes first; otherwise whatever the cashier has waiting.
  const waiting = charges.filter((c) => !c.taken).sort((a, b) => Number(b.id === scanned) - Number(a.id === scanned))

  async function pay(c: Charge) {
    if (busy.current) return // a second tap before the button disables
    busy.current = true
    setRunning(true)
    setEvents([])
    try {
      await stream<Ev>('/api/orders', { shop: shop.near_id, goal: `Pay ${fmt(c.amount)}${c.note ? ` for ${c.note}` : ''}`, charge: c.id }, (e) => setEvents((all) => [...all, e]))
    } catch (e) {
      setEvents((all) => [...all, { t: 'error', text: (e as Error).message }])
    } finally {
      busy.current = false
      setRunning(false)
    }
  }

  return (
    <main className="panel mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5">
      <Link to="/" className="w-fit rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">Back</Link>
      <ShopHeader shop={shop} />

      {events.length > 0 && <Transcript events={events} running={running} shop={shop} />}
      <div ref={end} />

      {!running && !paid && shop.verified && (
        waiting.length === 0 ? (
          <Card className="text-center">
            <p className="dots py-2" aria-hidden><i /><i /><i /></p>
            <h2 className="text-lg font-bold">Waiting for the cashier</h2>
            <p className="mt-1 text-sm text-soft">Ask them to key in what you owe. It appears here by itself, and nothing is paid until you say so.</p>
          </Card>
        ) : waiting.map((c, i) => (
          <Card key={c.id} className="space-y-3 text-center">
            <p className="text-sm text-soft">{c.note || 'To pay'}</p>
            <p className="num text-5xl font-extrabold tracking-tight">{fmt(c.amount)}</p>
            <p className="num text-xs text-soft">{usd(c.amount)} sUSD on NEAR</p>
            <Button tone={i === 0 ? 'primary' : 'quiet'} onClick={() => pay(c)} className="w-full">Pay {fmt(c.amount)}</Button>
            {i === 0 && <p className="text-xs text-soft">Check the amount with the cashier. Your agent asks the shop’s agent for the invoice, checks it matches and pays inside your limits.</p>}
          </Card>
        ))
      )}
      {paid && <Link to="/" className="mx-auto rounded-full bg-fill px-5 py-3 font-semibold hover:bg-line">Done</Link>}
      {!running && <Plans plans={shop.plans} shop={shop.name} />}
    </main>
  )
}
