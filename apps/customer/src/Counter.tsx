import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, stream, type Ev, type ReceiptData } from '@shared/api'
import { digits } from '@shared/Confirm'
import { Button, Card, fmt, usd } from '@shared/ui'
import type { Shop } from './ShopPage'
import { Plans } from './Subs'
import { ShopHeader } from './ShopHeader'
import { Transcript } from './Transcript'

type Charge = { id: string; amount: number; amount_kes: number; note: string; taken: boolean }
type Buys = { ok: boolean; says: string; what: string; charge_kes: number; charge: number }
const QUICK = [200, 500, 1000, 2000]

/**
 * A counter. You say how much you want to spend and on what ("diesel for 1,500"); the shop's agent works out
 * what that buys from its price list; your agent pays and you show the cashier a code to collect.
 * An amount the cashier keyed in shows here too.
 */
export default function Counter({ shop }: { shop: Shop & { charges?: Charge[] } }) {
  const [q] = useSearchParams()
  const scanned = q.get('c')
  const [charges, setCharges] = useState<Charge[]>(shop.charges ?? [])
  const [events, setEvents] = useState<Ev[]>([])
  const [running, setRunning] = useState(false)
  const [sku, setSku] = useState<string | null>(shop.items[0]?.sku ?? null)
  const [what, setWhat] = useState('')
  const [amount, setAmount] = useState('')
  const [buys, setBuys] = useState<Buys | null>(null)
  const busy = useRef(false)
  const end = useRef<HTMLDivElement>(null)
  const listed = shop.items.length > 0
  const kes = Math.round(Number(amount))

  // The cashier may key the amount in after this page is open.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) api<{ charges: Charge[] }>(`/api/shops/${shop.near_id}`).then((s) => setCharges(s.charges)).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [shop.near_id])

  // After paying, the pass on screen follows the till: it turns to "Collected" when the cashier hands over.
  const pass = events.find((e) => e.t === 'receipt' && !!e.pickup_code)
  const passId = pass?.t === 'receipt' ? pass.id : undefined
  useEffect(() => {
    if (!passId) return
    const t = setInterval(() => {
      if (document.hidden) return
      api<ReceiptData>(`/api/receipts/${passId}`).then((r) => {
        setEvents((all) => all.map((e) => (e.t === 'receipt' && e.id === passId ? { ...e, ticket: r.ticket } : e)))
      }).catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [passId])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  // What the amount buys, from the shop's own price list, a moment after typing stops.
  useEffect(() => {
    setBuys(null)
    if (!(kes >= 1) || (!listed && what.trim().length < 2)) return
    const t = setTimeout(() => {
      const ask = new URLSearchParams({ amount_kes: String(kes), ...(listed && sku ? { sku } : { note: what.trim() }) })
      api<Buys>(`/api/shops/${shop.near_id}/buys?${ask}`).then(setBuys).catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [kes, sku, what, listed, shop.near_id])

  const paid = events.some((e) => e.t === 'receipt')
  // The amount on the code that was scanned comes first; otherwise whatever the cashier has waiting.
  const waiting = charges.filter((c) => !c.taken).sort((a, b) => Number(b.id === scanned) - Number(a.id === scanned))

  async function run(body: object) {
    if (busy.current) return // a second tap before the button disables
    busy.current = true
    setRunning(true)
    setEvents([])
    try {
      await stream<Ev>('/api/orders', { shop: shop.near_id, ...body }, (e) => setEvents((all) => [...all, e]))
      setAmount('')
    } catch (e) {
      setEvents((all) => [...all, { t: 'error', text: (e as Error).message }])
    } finally {
      busy.current = false
      setRunning(false)
    }
  }
  const pay = (c: Charge) => run({ goal: `Pay ${fmt(c.amount)}${c.note ? ` for ${c.note}` : ''}`, charge: c.id })
  const item = shop.items.find((i) => i.sku === sku)
  const spend = () => buys?.ok && run({
    goal: `${listed && item ? item.name : what.trim()} for KES ${kes.toLocaleString('en-US')}`,
    spend: { sku: listed ? sku : null, amount_kes: kes, note: listed ? '' : what.trim() },
  })
  const field = 'rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'

  return (
    <main className="panel mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5">
      <Link to="/" className="w-fit rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">Back</Link>
      <ShopHeader shop={shop} />

      {events.length > 0 && <Transcript events={events} running={running} shop={shop} />}
      <div ref={end} />

      {!running && !paid && shop.verified && waiting.map((c, i) => (
        <Card key={c.id} className="space-y-3 text-center">
          <p className="text-sm text-soft">The cashier asks for{c.note ? `: ${c.note}` : ''}</p>
          <p className="num text-5xl font-extrabold tracking-tight">{fmt(c.amount)}</p>
          <p className="num text-xs text-soft">{usd(c.amount)} sUSD on NEAR</p>
          <Button tone={i === 0 ? 'primary' : 'quiet'} onClick={() => pay(c)} className="w-full">Pay {fmt(c.amount)}</Button>
          {i === 0 && <p className="text-xs text-soft">Check the amount with the cashier. Your agent asks the shop’s agent for the invoice, checks it matches and pays inside your limits.</p>}
        </Card>
      ))}

      {/* A shop that lists no prices and sells by subscription (an internet provider) has nothing to buy by amount. */}
      {!running && !paid && shop.verified && (listed || shop.plans.length === 0) && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">{waiting.length ? 'Or buy by amount' : 'How much do you want to spend?'}</h2>
            <p className="mt-0.5 text-sm text-soft">Say the money. {shop.name}’s agent works out what it buys.</p>
          </div>
          {listed ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="What to buy">
              {shop.items.map((i) => (
                <button key={i.sku} type="button" aria-pressed={sku === i.sku} onClick={() => setSku(i.sku)}
                  className={`rounded-2xl px-3.5 py-2 text-left text-sm ${sku === i.sku ? 'bg-ink text-white' : 'bg-fill hover:bg-line'}`}>
                  <span className="block font-semibold">{i.name}</span>
                  <span className={`num block text-xs ${sku === i.sku ? 'opacity-70' : 'text-soft'}`}>KES {i.price_kes.toLocaleString('en-US')}{i.unit ? ` a ${i.unit}` : ' each'}</span>
                </button>
              ))}
            </div>
          ) : (
            <input aria-label="What it is for" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={60} placeholder="What for? e.g. Diesel" className={`${field} w-full text-sm`} />
          )}
          <div>
            <label className="flex items-center gap-3">
              <span className="text-sm font-semibold text-soft">KES</span>
              <input aria-label="Amount in shillings" inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} placeholder="0" className={`${field} num min-w-0 flex-1 text-3xl font-extrabold tracking-tight`} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK.map((n) => <button key={n} type="button" onClick={() => setAmount(String(n))} className="num rounded-full bg-fill px-3 py-1.5 text-sm font-medium hover:bg-line">{n.toLocaleString('en-US')}</button>)}
            </div>
          </div>
          <p className={`min-h-[3.25rem] rounded-2xl px-4 py-3 text-sm ${buys ? (buys.ok ? 'bg-good-wash text-good' : 'bg-bad-wash text-bad') : 'bg-canvas text-soft'}`} aria-live="polite">
            {buys ? buys.says : kes >= 1 ? 'Working out what that buys…' : 'Enter an amount to see what it buys.'}
          </p>
          <Button disabled={!buys?.ok} onClick={spend} className="w-full">{buys?.ok ? `Pay KES ${buys.charge_kes.toLocaleString('en-US')}` : 'Pay'}</Button>
          <p className="text-xs text-soft">
            Your agent checks the shop, asks its agent for the invoice and pays inside your limits. You get a code to show the cashier, who hands over what you bought.
            {waiting.length === 0 && ' If the cashier keys in an amount instead, it appears here by itself.'}
          </p>
        </Card>
      )}
      {paid && <Link to="/" className="mx-auto rounded-full bg-fill px-5 py-3 font-semibold hover:bg-line">Done</Link>}
      {!running && <Plans plans={shop.plans} shop={shop.name} />}
    </main>
  )
}
