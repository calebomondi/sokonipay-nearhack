import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api, stream, type Ev } from '@shared/api'
import { Button, Card, Notice, Spinner, fmt } from '@shared/ui'
import { Transcript } from './Transcript'
import Counter from './Counter'
import { ShopHeader } from './ShopHeader'
import { Plans, type PlanRow } from './Subs'
import Venue from './Venue'

export type Shop = {
  near_id: string; name: string; blurb: string; place: string; verified: boolean; kind: string
  hours: { open: string; close: string } | null; open: boolean; gate_says: string
  items: { sku: string; name: string; price: number; price_kes: number; stock: number; unit: string; whole: boolean }[]
  /** For a venue that is closed: a ticket bought now is for "today" (it opens later) or "tomorrow". */
  ticket_day: string; ticket_says: string
  plans: PlanRow[]
  hours_line: string; discounts_for: string[]
}

/** Starting points built from this shop's own menu. */
function ideas(shop: Shop) {
  const inStock = shop.items.filter((i) => i.stock > 0)
  const out = [{ label: 'Something for me, under 800', goal: 'Something filling for me, under KES 800', party: 1 }]
  if (inStock[0]) out.push({ label: `Two ${inStock[0].name}`, goal: `2 ${inStock[0].name}`, party: 1 })
  if (inStock.length > 1) out.push({ label: 'Lunch for two, split the bill', goal: 'Lunch for two', party: 2 })
  return out
}

export default function ShopPage() {
  const { id = '' } = useParams()
  const [q, setQ] = useSearchParams()
  const [tableCode, setTableCode] = useState<string | null>(q.get('p'))
  const [shop, setShop] = useState<Shop | null>(null)
  const [error, setError] = useState('')
  const [goal, setGoal] = useState('')
  const [party, setParty] = useState(1)
  const [events, setEvents] = useState<Ev[]>([])
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  useEffect(() => {
    api<Shop>(`/api/shops/${id}`).then(setShop).catch((e) => setError(e.message))
  }, [id])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  async function send(text = goal, people = party) {
    if (!shop || busy.current || text.trim().length < 3) return
    busy.current = true
    setRunning(true)
    setEvents([])
    setCopied(false)
    try {
      await stream<Ev>('/api/orders', {
        shop: shop.near_id, goal: text, mode: tableCode ? 'table' : 'pickup', presence: tableCode,
        party_size: people,
      }, (e) => setEvents((all) => [...all, e]))
    } catch (e) {
      setEvents((all) => [...all, { t: 'error', text: (e as Error).message }])
    } finally {
      busy.current = false
      setRunning(false)
      if (tableCode) {
        setTableCode(null) // a table code works once
        setQ({}, { replace: true })
      }
    }
  }

  if (error) return <div className="mx-auto max-w-md space-y-3 p-5"><Notice>{error}</Notice><Link to="/" className="font-medium text-iris">Back to shops</Link></div>
  if (!shop) return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>
  if (shop.kind === 'venue') return <Venue shop={shop} />
  if (shop.kind === 'counter') return <Counter shop={shop} />

  const waiting = [...events].reverse().find((e) => e.t === 'collecting') as Extract<Ev, { t: 'collecting' }> | undefined
  const settled = events.some((e) => e.t === 'receipt')
  const joinLink = waiting ? `${location.origin}/join/${waiting.order_id}` : ''

  return (
    <main className="mx-auto flex panel w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5">
      <Link to="/" className="w-fit rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">Back</Link>
      <ShopHeader shop={shop} />
      <p className="px-1 text-sm text-soft">{tableCode ? 'You scanned the code at the shop, so this is a table order.' : 'Ordering ahead for pickup. Your agent talks to the shop’s agent for you.'}</p>

      <details className="rounded-3xl bg-card px-5 py-4 text-sm">
        <summary className="cursor-pointer font-semibold">Menu</summary>
        <ul className="mt-3 space-y-1.5">
          {shop.items.map((i) => (
            <li key={i.sku} className="flex justify-between gap-3">
              <span className={i.stock ? '' : 'text-soft line-through'}>{i.name}</span>
              <span className="num text-soft">{fmt(i.price)}</span>
            </li>
          ))}
        </ul>
      </details>

      {events.length > 0 && <Transcript events={events} running={running} shop={shop} />}

      {waiting && !settled && !running && (
        <Card className="rise space-y-3">
          <h2 className="text-xl font-bold">Your share is paid. Waiting for {waiting.party_size - waiting.paid.length} more.</h2>
          <p className="text-sm text-soft">
            <span className="num font-medium text-ink">{fmt(waiting.funded)}</span> of <span className="num font-medium text-ink">{fmt(waiting.total)}</span> is in escrow.
            Send this link to the others. The shop is paid when the last share arrives, and everyone is refunded if it never does.
          </p>
          <div className="flex gap-2">
            <input readOnly value={joinLink} aria-label="Split-bill link" className="min-w-0 flex-1 rounded-full bg-fill px-4 py-2.5 text-sm" onFocus={(e) => e.target.select()} />
            <Button
              className="text-sm"
              onClick={() => navigator.clipboard?.writeText(joinLink).then(() => setCopied(true)).catch(() => {})}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </Card>
      )}
      <div ref={end} />

      {!running && shop.verified && (
        <form
          className="space-y-4 rounded-3xl bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <label htmlFor="goal" className="block text-lg font-bold">{events.length ? 'Order something else' : 'Tell your agent what you want'}</label>
          <textarea
            id="goal" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Lunch for me, under KES 800"
            className="w-full resize-none rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">People splitting the bill</span>
            <div className="flex items-center gap-1 rounded-full bg-fill p-1">
              <button type="button" aria-label="One fewer" disabled={party <= 1} onClick={() => setParty(party - 1)} className="h-9 w-9 rounded-full bg-card text-lg font-semibold disabled:opacity-40">−</button>
              <span className="num w-8 text-center font-semibold" aria-live="polite">{party}</span>
              <button type="button" aria-label="One more" disabled={party >= 8} onClick={() => setParty(party + 1)} className="h-9 w-9 rounded-full bg-card text-lg font-semibold disabled:opacity-40">+</button>
            </div>
          </div>
          {party > 1 && (
            <p className="text-sm text-soft">Your agent pays your share. You then get a link to send to the others, and each person’s agent pays theirs.</p>
          )}
          <Button disabled={goal.trim().length < 3} className="w-full">Send my agent</Button>
          <div>
            <p className="mb-2 text-sm text-soft">Or try one of these</p>
            <div className="flex flex-wrap gap-2">
              {ideas(shop).map((i) => (
                <button
                  key={i.label} type="button"
                  onClick={() => {
                    setGoal(i.goal)
                    setParty(i.party)
                    send(i.goal, i.party)
                  }}
                  className="rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line"
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>
        </form>
      )}
      {!running && <Plans plans={shop.plans} shop={shop.name} />}
    </main>
  )
}
