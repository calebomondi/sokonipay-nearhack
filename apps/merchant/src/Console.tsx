import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, type Limits, type Line, type Ticket } from '@shared/api'
import { Profile } from '@shared/Profile'
import { Scanner } from '@shared/Scanner'
import { Button, Card, EXPLORER_ACCOUNT, Meter, Money, Notice, Spinner, Tick, TxLink, fmt, when } from '@shared/ui'

type Item = { sku: string; name: string; price: number; price_kes: number; tags: string[]; stock: number; reorder_at: number; restock_qty: number }
type OrderRow = { id: string; customer: string; party_size: number; goal: string; mode: string; status: string; invoice_id: string | null; kind: string | null; total: number | null; lines: Line[] | null; agents: string; at: string }
type Rule = { kind: 'total' | 'group' | 'time' | 'returning'; percent: number; min_kes?: number; people?: number; visits?: number; from?: string; to?: string; says: string }
type ChargeRow = { id: string; amount: number; amount_kes: number; note: string; at: string; taken: boolean }
type Data = {
  near_id: string; name: string; place: string; verified: boolean; agents: string
  kind: 'venue' | 'food' | 'counter'; status: 'pending' | 'approved' | 'suspended'; hours: { open: string; close: string } | null; open: boolean
  balance: number; limits: Limits | null
  splits: { account_id: string; bps: number; balance: number }[]
  supplier: { near_id: string; name: string } | null
  presence: { token: string; expires_in_ms: number }
  items: Item[]; orders: OrderRow[]; discounts: Rule[]; charges: ChargeRow[]
  plans: { id: string; name: string; price_kes: number; every: string; subscribers: number }[]
  log: { kind: string; text: string; tx_hash: string | null; at: string }[]
}
type Tab = 'overview' | 'sales' | 'catalogue' | 'plans' | 'rules'

const CUSTOMER_APP = (import.meta.env.VITE_CUSTOMER_APP_URL as string | undefined) ?? 'http://localhost:5173'
const STATUS: Record<string, { text: string; cls: string }> = {
  negotiating: { text: 'Agents talking', cls: 'bg-fill text-ink' },
  collecting: { text: 'Collecting shares', cls: 'bg-fill text-ink' },
  paid: { text: 'Paid', cls: 'bg-good-wash text-good' },
  refunded: { text: 'Refunded', cls: 'bg-fill text-ink' },
  refused: { text: 'Refused by contract', cls: 'bg-bad-wash text-bad' },
  failed: { text: 'Not completed', cls: 'bg-fill text-soft' },
}

export default function Console({ isAdmin }: { isAdmin: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [refunding, setRefunding] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  // An answer can take longer than the 4 seconds between polls. A poll waits for the one in flight;
  // a load after a save always goes out, and any older answer still on its way is dropped.
  const asked = useRef(0)
  const flying = useRef(0)
  const load = useCallback((poll = false) => {
    if (poll && flying.current > 0) return
    const mine = ++asked.current
    flying.current++
    return api<Data>('/api/console')
      .then((x) => { if (mine === asked.current) { setD(x); setError('') } })
      .catch((e) => { if (mine === asked.current) setError(e.message) })
      .finally(() => { flying.current-- })
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 4000)
    return () => clearInterval(t)
  }, [load])

  const refund = async (o: OrderRow) => {
    if (refunding || !window.confirm(`Give ${fmt(o.total ?? 0)} back to ${o.customer}? This can’t be undone.`)) return
    setRefunding(o.id)
    try {
      await api('/api/console/refund', { body: { id: o.invoice_id } })
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefunding(null)
      void load()
    }
  }

  if (!d) return <div className="flex min-h-dvh items-center justify-center">{error ? <Notice>{error}</Notice> : <Spinner />}</div>
  const venue = d.kind === 'venue'
  const counter = d.kind === 'counter'
  const live = d.status === 'approved'
  const lim = d.limits
  const kept = 10_000 - d.splits.reduce((s, x) => s + x.bps, 0)
  // A venue's or counter's code is fixed and only names the shop. A stall's code changes, to prove the customer is there.
  const code = d.kind === 'food' ? `${CUSTOMER_APP}/pay?m=${d.near_id}&p=${d.presence.token}` : `${CUSTOMER_APP}/pay?m=${d.near_id}`
  const sold = d.orders.filter((o) => o.kind === 'Ticket' && o.status === 'paid')
  const people = sold.reduce((n, o) => n + (o.lines ?? []).reduce((m, l) => m + l.qty, 0), 0)
  const paid = d.orders.filter((o) => o.status === 'paid')
  const words = { sales: venue ? 'Ticket sales' : counter ? 'Sales' : 'Orders', catalogue: venue ? 'Tickets and hours' : 'Menu and stock' }
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['sales', words.sales], ...(counter ? [] : [['catalogue', words.catalogue] as [Tab, string]]), ['plans', 'Subscriptions'], ['rules', 'Discounts and split']]

  const sales = (rows: OrderRow[]) => rows.length === 0 ? (
    <Card><p className="text-sm text-soft">{venue ? 'No tickets sold yet. When someone scans your code and buys, the sale appears here.' : counter ? 'No sales yet. Key in an amount and the customer scans your code to pay it.' : 'No orders yet. When a customer’s agent contacts your agent, the order appears here.'}</p></Card>
  ) : (
    <Card className="!p-0">
      <ul className="divide-y divide-line">
        {rows.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
            <div className="min-w-0 flex-1 basis-52">
              <p className="font-semibold">{o.customer}{o.party_size > 1 ? ` and ${o.party_size - 1} more` : ''}</p>
              {o.lines ? <p className={`text-sm ${o.status === 'refunded' ? 'text-soft line-through' : ''}`}>{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</p> : <p className="text-sm text-soft">“{o.goal}”</p>}
              <p className="text-xs text-soft">{when(o.at)}{d.kind !== 'food' ? '' : o.mode === 'table' ? ', at the stall' : ', pickup'}{o.invoice_id && o.kind === 'Ticket' ? `, ${o.invoice_id}` : ''}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[o.status]?.cls ?? 'bg-fill'}`}>{STATUS[o.status]?.text ?? o.status}</span>
            <span className="w-28 text-right">
              {o.total != null && (
                o.status === 'paid' && o.invoice_id
                  ? <a href={`${CUSTOMER_APP}/r/${o.invoice_id}`} target="_blank" rel="noreferrer" className="hover:underline"><Money micro={o.total} className="font-semibold" /></a>
                  : <Money micro={o.total} className="font-semibold text-soft" />
              )}
            </span>
            <span className="w-28 text-right">
              {o.status === 'paid' && o.invoice_id && (
                <button type="button" disabled={refunding !== null} onClick={() => refund(o)} className="rounded-full bg-fill px-3 py-1.5 text-xs font-semibold hover:bg-line disabled:opacity-50">
                  {refunding === o.id ? 'Refunding…' : 'Refund in full'}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )

  return (
    <div className="min-h-dvh">
      {/* The bar that stays: who you are, where you are in the console, and your account. */}
      <div className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur print:hidden">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <p className="flex items-center gap-2 font-bold"><span className="h-2.5 w-2.5 rounded-full bg-iris" aria-hidden />SokoniPay <span className="font-medium text-soft">for shops</span></p>
          <nav aria-label="Console sections" className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1">
            {tabs.map(([id, text]) => (
              <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${tab === id ? 'bg-ink text-white' : 'text-soft hover:bg-fill hover:text-ink'}`}>{text}</button>
            ))}
            <Link to="/statement" className="shrink-0 rounded-full px-3.5 py-2 text-sm font-medium text-soft hover:bg-fill hover:text-ink">Daily statement</Link>
            {isAdmin && <Link to="/admin" className="shrink-0 rounded-full px-3.5 py-2 text-sm font-medium text-soft hover:bg-fill hover:text-ink">Admin</Link>}
          </nav>
          <div className="ml-auto"><Profile name={d.name} nearId={d.near_id} align="right" items={[{ label: 'Open the customer app', href: CUSTOMER_APP }]} /></div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-5 pb-14 pt-7">
        <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight">{d.name} {d.verified && <Tick size={26} />}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-soft">
              {d.place}
              {d.hours && <span>Open {d.hours.open} to {d.hours.close}{venue ? (d.open ? ', open now' : ', closed now') : ''}</span>}
              <a href={EXPLORER_ACCOUNT + d.near_id} target="_blank" rel="noreferrer" className="hover:underline">{d.near_id}</a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.verified ? null : d.status === 'suspended'
              ? <span className="rounded-full bg-bad-wash px-2.5 py-1 text-xs font-semibold text-bad">Suspended</span>
              : <span className="rounded-full bg-amber-wash px-2.5 py-1 text-xs font-semibold text-amber">Not verified yet</span>}
            {d.kind === 'food' && <span className="rounded-full bg-card px-3 py-1.5 text-xs font-medium">Agent: {d.agents}</span>}
          </div>
        </header>
        {error && <Notice>{error}</Notice>}
        {d.status === 'pending' && (
          <div className="rounded-3xl bg-amber-wash p-5 print:hidden">
            <p className="text-lg font-bold text-amber">Waiting for SokoniPay to verify your shop</p>
            <p className="mt-1 text-sm">Customers can’t find you yet, and your code appears once you’re verified. Meanwhile, set up your {venue ? 'tickets and hours' : counter ? 'discounts and split' : 'menu'}.</p>
          </div>
        )}
        {d.status === 'suspended' && <div className="print:hidden"><Notice>SokoniPay has suspended this shop. Customers can’t pay you until it is verified again.</Notice></div>}

        {tab === 'overview' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
              <Card className="bg-ink text-white">
                <p className="text-sm text-white/70">Balance</p>
                <p className="mt-1 text-4xl font-extrabold tracking-tight"><Money micro={d.balance} className="[&>span:first-child]:text-white/60" /></p>
                <p className="mt-2 text-xs text-white/70">{kept / 100}% of every sale stays here</p>
              </Card>
              {d.splits.map((s) => (
                <Card key={s.account_id}>
                  <p className="text-sm capitalize text-soft">{s.account_id.split('.')[0]}</p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight"><Money micro={s.balance} /></p>
                  <p className="mt-2 text-xs text-soft">{s.bps / 100}% of every sale, split by the contract</p>
                </Card>
              ))}
              <Card className={d.splits.length === 0 ? 'lg:col-span-3' : d.splits.length === 1 ? 'lg:col-span-2' : ''}>
                {venue ? (
                  <>
                    <p className="text-sm text-soft">Recent ticket sales</p>
                    <p className="num mt-1 text-4xl font-extrabold tracking-tight">{people} <span className="text-base font-semibold text-soft">{people === 1 ? 'person' : 'people'}</span></p>
                    <p className="mt-2 text-xs text-soft">On {sold.length} {sold.length === 1 ? 'ticket' : 'tickets'}. Each customer paid from their own phone, with no phone number given at the gate.</p>
                  </>
                ) : counter ? (
                  <>
                    <p className="text-sm text-soft">Recent sales</p>
                    <p className="num mt-1 text-4xl font-extrabold tracking-tight">{paid.length} <span className="text-base font-semibold text-soft">paid</span></p>
                    <p className="mt-2 text-xs text-soft">You key in the amount, the customer scans, their agent pays. No card machine and no phone number.</p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm text-soft">Your agent can spend today</p>
                      <p className="num text-sm"><span className="font-semibold">{lim ? fmt(Math.max(0, lim.per_day - lim.spent_in_window)) : fmt(0)}</span> <span className="text-soft">of {lim ? fmt(lim.per_day) : fmt(0)}</span></p>
                    </div>
                    <div className="mt-3"><Meter used={lim?.spent_in_window ?? 0} max={lim?.per_day ?? 0} /></div>
                    <p className="mt-3 text-xs text-soft">
                      {d.supplier
                        ? <>It restocks from {d.supplier.name} on its own, up to <span className="num">{lim ? fmt(lim.per_payment) : fmt(0)}</span> a purchase. </>
                        : 'No supplier is connected yet, so your agent doesn’t restock. '}
                      It can’t withdraw, raise these limits or change the split.
                    </p>
                  </>
                )}
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6 print:hidden">
                {counter && live && <Charge charges={d.charges} shopId={d.near_id} onDone={() => load()} />}
                {venue && <Gate orders={d.orders} onDone={() => load()} />}
                <section className="space-y-3">
                  <div className="flex items-baseline justify-between px-1">
                    <h2 className="text-xl font-bold">Latest {words.sales.toLowerCase()}</h2>
                    {d.orders.length > 5 && <button type="button" onClick={() => setTab('sales')} className="text-sm font-semibold text-iris hover:underline">See all</button>}
                  </div>
                  {sales(d.orders.slice(0, 5))}
                </section>
                <section className="space-y-3">
                  <h2 className="px-1 text-xl font-bold">What your agent did</h2>
                  <Card>
                    {d.log.length === 0 ? (
                      <p className="text-sm text-soft">Nothing yet. Sales, {venue ? 'entries at the gate' : 'refunds'} and refused payments are listed here as they happen.</p>
                    ) : (
                      <ol className="space-y-3 text-sm">
                        {d.log.slice(0, 8).map((l, n) => (
                          <li key={n} className="flex gap-3">
                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${l.kind === 'refused' ? 'bg-bad' : l.kind === 'refund' ? 'bg-amber' : l.kind === 'restock' ? 'bg-iris' : l.kind === 'sale' ? 'bg-good' : 'bg-line'}`} />
                            <span>
                              {l.text} {l.tx_hash && <TxLink hash={l.tx_hash} />}
                              <span className="block text-xs text-soft">{when(l.at)}</span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Card>
                </section>
              </div>

              <aside className="space-y-4">
                {live ? (
                  <Card className="text-center print:shadow-none">
                    <h2 className="text-xl font-bold print:text-4xl">{venue ? 'Scan to get your ticket' : counter ? 'Scan to pay' : 'Scan to order'}</h2>
                    <p className="hidden text-2xl font-semibold print:block">{d.name}</p>
                    <a href={code} target="_blank" rel="noreferrer" aria-label="Open this code as a customer" className="mx-auto mt-3 block w-fit rounded-2xl border border-line p-3">
                      <QRCodeSVG value={code} size={196} fgColor="#0c0e12" bgColor="#ffffff" level="M" />
                    </a>
                    <p className="mt-3 text-sm text-soft">
                      {d.kind === 'food'
                        ? 'This code changes every 10 seconds. An order through it proves the customer is at your stall. No location is collected.'
                        : `This code only says who you are. It takes no payment and doesn’t change, so you can print it for the ${venue ? 'gate' : 'counter'}. Customers’ agents pay only because your shop is verified on NEAR.`}
                    </p>
                    <div className="mt-3 flex justify-center gap-2 print:hidden">
                      {d.kind !== 'food' && <Button tone="quiet" onClick={() => window.print()} className="!py-2 text-sm">Print for the {venue ? 'gate' : 'counter'}</Button>}
                    </div>
                    <p className="mt-2 text-xs text-soft print:hidden">No phone to hand? Click the code to open it as a customer.</p>
                  </Card>
                ) : (
                  <Card className="text-center">
                    <h2 className="text-xl font-bold">Your code</h2>
                    <div className="mx-auto mt-3 flex h-[196px] w-[196px] items-center justify-center rounded-2xl bg-fill px-6 text-sm text-soft">Appears here once your shop is verified</div>
                  </Card>
                )}
              </aside>
            </div>
          </>
        )}

        {tab === 'sales' && (
          <section className="space-y-3">
            <h2 className="px-1 text-xl font-bold">{words.sales}</h2>
            {sales(d.orders)}
            <p className="px-1 text-xs text-soft">The latest 15. For a whole day with totals, open the <Link to="/statement" className="font-semibold text-ink underline underline-offset-2">daily statement</Link>.</p>
          </section>
        )}

        {tab === 'catalogue' && !counter && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="space-y-3">
              <h2 className="px-1 text-xl font-bold">{venue ? 'Your tickets' : 'Menu and stock'}</h2>
              <Items items={d.items} venue={venue} restocks={!!d.supplier} onSaved={() => load()} />
            </section>
            {venue && d.hours && <section className="space-y-3"><h2 className="px-1 text-xl font-bold">Hours</h2><Hours hours={d.hours} onSaved={() => load()} /></section>}
          </div>
        )}

        {tab === 'plans' && <PlanList plans={d.plans} onSaved={() => load()} />}

        {tab === 'rules' && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Discounts rules={d.discounts} kind={d.kind} onSaved={() => load()} />
            <Split splits={d.splits} onSaved={() => load()} />
          </div>
        )}
      </main>
    </div>
  )
}

/** Things billed on a schedule. Customers subscribe themselves; the shop's agent bills each period. */
function PlanList({ plans, onSaved }: { plans: Data['plans']; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [period, setPeriod] = useState('month')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      setError('')
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const cell = 'rounded-full bg-fill px-4 py-2 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  return (
    <section className="max-w-3xl space-y-3">
      <h2 className="px-1 text-xl font-bold">Subscriptions</h2>
      <Card>
        <p className="text-sm text-soft">
          Offer something billed every week or month: a membership, a season pass, a software plan. A customer subscribes on your page, which writes their permission to the NEAR contract.
          Your agent then sends the bill each period and their agent pays it. The contract only lets you bill the agreed amount, once per period.
        </p>
        {plans.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm">No plans yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="block font-semibold">{p.name}</span>
                  <span className="num text-sm text-soft">KES {p.price_kes.toLocaleString('en-US')} {p.every}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="num rounded-full bg-fill px-3 py-1 text-xs font-semibold">{p.subscribers} {p.subscribers === 1 ? 'subscriber' : 'subscribers'}</span>
                  <button type="button" disabled={busy} onClick={() => run(() => api(`/api/console/plans/${p.id}`, { method: 'DELETE' }))} className="text-sm font-medium text-bad hover:underline disabled:opacity-50">Stop offering</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4" onSubmit={(e) => {
          e.preventDefault()
          void run(() => api('/api/console/plans', { body: { name: name.trim(), price_kes: Math.round(Number(price)), period } })).then(() => { setName(''); setPrice('') })
        }}>
          <input aria-label="Plan name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Monthly membership" className={`${cell} min-w-0 flex-1`} />
          <input aria-label="Price in shillings" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="KES" className={`${cell} num w-24 text-right`} />
          <select aria-label="Billed" value={period} onChange={(e) => setPeriod(e.target.value)} className={cell}>
            <option value="month">every month</option><option value="week">every week</option><option value="test">every 5 minutes (for testing)</option>
          </select>
          <Button disabled={busy || name.trim().length < 2 || !(Number(price) >= 1)} className="!px-4 !py-2 text-sm">Add plan</Button>
        </form>
        {error && <div className="mt-3"><Notice>{error}</Notice></div>}
        <p className="mt-3 text-xs text-soft">Stopping a plan takes no new subscribers. People already subscribed stay until they cancel. Renewals appear under your sales and in the daily statement.</p>
      </Card>
    </section>
  )
}

const RULE_KINDS: { kind: Rule['kind']; label: string }[] = [
  { kind: 'total', label: 'The order is at least' },
  { kind: 'group', label: 'The group is at least' },
  { kind: 'time', label: 'The time is between' },
  { kind: 'returning', label: 'The customer has paid here at least' },
]

/** When a discount may be given, and how much at most. The shop's agent bargains inside these and never past them. */
function Discounts({ rules, kind, onSaved }: { rules: Rule[]; kind: Data['kind']; onSaved: () => void }) {
  const [type, setType] = useState<Rule['kind']>('total')
  const [value, setValue] = useState('')
  const [start, setStart] = useState('14:00')
  const [end, setEnd] = useState('16:00')
  const [percent, setPercent] = useState('5')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // The API returns each rule with the words for it; only the rule itself is sent back.
  const plain = (r: Rule) => ({ kind: r.kind, percent: r.percent, min_kes: r.min_kes, people: r.people, visits: r.visits, start: r.from, end: r.to })
  const save = async (next: ReturnType<typeof plain>[]) => {
    setBusy(true)
    try {
      await api('/api/console/discounts', { body: { rules: next } })
      setNote({ ok: true, text: 'Saved. Your agent uses these from the next order.' })
      setValue('')
      onSaved()
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const n = Math.round(Number(value))
  const fresh = { kind: type, percent: Number(percent), min_kes: type === 'total' ? n : undefined, people: type === 'group' ? n : undefined,
    visits: type === 'returning' ? n : undefined, start: type === 'time' ? start : undefined, end: type === 'time' ? end : undefined }
  const ready = Number(percent) > 0 && Number(percent) <= 50 && (type === 'time' ? start !== end : type === 'group' ? n >= 2 : n >= 1)
  const cell = 'num rounded-full bg-fill px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-iris'

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-xl font-bold">Discount rules</h2>
      <Card>
        <p className="text-sm text-soft">
          Say when a discount may be given and the most it can be. When a customer’s agent asks for a better price, your agent can go up to the best rule the order meets, and never past it.
          {kind !== 'food' ? ' A rule that fits is applied when the customer’s agent asks.' : ''} Rules don’t add up: only the most generous one counts.
        </p>
        {rules.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm">No rules yet, so your prices are final.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {rules.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <span className="text-sm"><span className="num rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">up to {r.percent}%</span> <span className="ml-2">for {r.says}</span></span>
                <button type="button" disabled={busy} onClick={() => save(rules.filter((_, k) => k !== i).map(plain))} className="text-sm font-medium text-bad hover:underline disabled:opacity-50">Remove</button>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); void save([...rules.map(plain), fresh]) }}>
          <span className="text-sm font-medium">When</span>
          <select aria-label="Condition" value={type} onChange={(e) => { setType(e.target.value as Rule['kind']); setValue('') }} className={cell}>
            {RULE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          {type === 'time' ? (
            <>
              <input type="time" aria-label="From" value={start} onChange={(e) => setStart(e.target.value)} className={cell} />
              <span className="text-sm text-soft">and</span>
              <input type="time" aria-label="To" value={end} onChange={(e) => setEnd(e.target.value)} className={cell} />
            </>
          ) : (
            <>
              <input aria-label="Value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'total' ? 'KES' : type === 'group' ? '4' : '3'} className={`${cell} w-24 text-right`} />
              <span className="text-sm text-soft">{type === 'total' ? 'shillings' : type === 'group' ? (kind === 'venue' ? 'tickets' : 'people') : 'times'}</span>
            </>
          )}
          <span className="text-sm font-medium">give up to</span>
          <input aria-label="Percent off" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className={`${cell} w-16 text-right`} />
          <span className="text-sm text-soft">% off</span>
          <Button disabled={busy || !ready || rules.length >= 8} className="!px-4 !py-2 text-sm">Add rule</Button>
        </form>
        {note && <div className="mt-3"><Notice tone={note.ok ? 'good' : 'bad'}>{note.text}</Notice></div>}
      </Card>
    </section>
  )
}

/** A counter: key in what the customer owes. They scan the code, their agent pays, and it turns green here. */
function Charge({ charges, shopId, onDone }: { charges: ChargeRow[]; shopId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [what, setWhat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      setError('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const field = 'rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  return (
    <Card>
      <h2 className="text-xl font-bold">Charge a customer</h2>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault()
        void run(() => api('/api/console/charges', { body: { amount_kes: Math.round(Number(amount)), note: what.trim() } })).then(() => { setAmount(''); setWhat('') })
      }}>
        <label className="sr-only" htmlFor="charge-amount">Amount in shillings</label>
        <input id="charge-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="KES" className={`${field} num w-36 text-2xl font-extrabold`} />
        <input aria-label="What it is for (optional)" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={80} placeholder="What it’s for, e.g. Diesel, 12 litres" className={`${field} min-w-0 flex-1 text-sm`} />
        <Button disabled={busy || !(Number(amount) >= 1)}>Ask for payment</Button>
      </form>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      {charges.length === 0 ? (
        <p className="mt-3 text-sm text-soft">Key in the amount. The customer scans your code, sees it, and their agent pays. An amount nobody pays lapses after 10 minutes.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {charges.map((c, i) => {
            const link = `${CUSTOMER_APP}/pay?m=${shopId}&c=${c.id}`
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-canvas p-4">
                {i === 0 && <a href={link} target="_blank" rel="noreferrer" aria-label="Open this amount as a customer" className="rounded-xl bg-white p-2"><QRCodeSVG value={link} size={92} fgColor="#0c0e12" bgColor="#ffffff" level="M" /></a>}
                <div className="min-w-0 flex-1">
                  <p className="num text-2xl font-extrabold tracking-tight">KES {c.amount_kes.toLocaleString('en-US')}</p>
                  <p className="text-sm">{c.note || 'Counter sale'}</p>
                  <p className="text-xs text-soft">{c.taken ? 'The customer’s agent is paying…' : `Waiting for the customer to scan, since ${when(c.at)}`}</p>
                </div>
                <button type="button" disabled={busy || c.taken} onClick={() => run(() => api(`/api/console/charges/${c.id}/cancel`, { method: 'POST' }))} className="rounded-full bg-fill px-3 py-1.5 text-xs font-semibold hover:bg-line disabled:opacity-50">Cancel</button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function Items({ items, venue, restocks, onSaved }: { items: Item[]; venue: boolean; restocks: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [category, setCategory] = useState('main')
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      setError('')
      setEditing(null)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const cell = 'num w-20 rounded-xl bg-fill px-2 py-1.5 text-right outline-none focus:ring-2 focus:ring-iris'
  return (
    <Card className="!p-0">
      {error && <div className="p-4"><Notice>{error}</Notice></div>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-soft">
          <tr>
            <th className="px-5 py-3 font-medium">{venue ? 'Ticket' : 'Item'}</th>
            <th className="py-3 text-right font-medium">Price, KES</th>
            {!venue && <th className="py-3 text-right font-medium">In stock</th>}
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((i) => (
            <tr key={i.sku}>
              <td className="px-5 py-2.5 font-medium">
                {i.name}
                {restocks && i.restock_qty > 0 && i.stock <= i.reorder_at && <span className="ml-2 rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-soft">restocking</span>}
              </td>
              {editing === i.sku ? (
                <>
                  <td className="py-2 text-right"><input aria-label={`Price of ${i.name}`} className={cell} value={price} onChange={(e) => setPrice(e.target.value)} /></td>
                  {!venue && <td className="py-2 text-right"><input aria-label={`Stock of ${i.name}`} className={cell} value={stock} onChange={(e) => setStock(e.target.value)} /></td>}
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    <button onClick={() => run(() => api(`/api/console/items/${i.sku}`, { method: 'PATCH', body: venue ? { price_kes: Math.round(Number(price)) } : { price_kes: Math.round(Number(price)), stock: Math.round(Number(stock)) } }))} className="font-semibold text-iris">Save</button>
                    <button onClick={() => run(() => api(`/api/console/items/${i.sku}`, { method: 'DELETE' }))} className="ml-3 font-medium text-bad">Remove</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="num py-2.5 text-right">{i.price_kes.toLocaleString('en-US')}</td>
                  {!venue && <td className="num py-2.5 text-right">{i.stock}{restocks && i.restock_qty > 0 && <span className="text-soft"> / reorder at {i.reorder_at}</span>}</td>}
                  <td className="px-5 py-2.5 text-right">
                    <button onClick={() => { setEditing(i.sku); setPrice(String(i.price_kes)); setStock(String(i.stock)) }} className="font-medium text-soft hover:text-ink">Edit</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="px-5 pb-2 text-sm text-soft">{venue ? 'Add the tickets you sell at the gate, with your own prices.' : 'Add what you sell.'}</p>}
      <form
        className="flex flex-wrap gap-2 border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api('/api/console/items', { body: { name: newName.trim(), price_kes: Math.round(Number(newPrice)), category } })).then(() => { setNewName(''); setNewPrice('') })
        }}
      >
        <input aria-label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={venue ? 'Adult' : 'Chapati'} className="min-w-0 flex-1 rounded-full bg-fill px-4 py-2 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris" />
        {!venue && (
          <select aria-label="Kind of dish" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-full bg-fill px-3 py-2 text-sm">
            <option value="main">Main</option><option value="side">Side</option><option value="drink">Drink</option>
          </select>
        )}
        <input aria-label="Price in shillings" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} inputMode="numeric" placeholder="KES" className="num w-24 rounded-full bg-fill px-4 py-2 text-right text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris" />
        <Button tone="dark" disabled={newName.trim().length < 2 || !(Number(newPrice) >= 1)} className="!px-4 !py-2 text-sm">Add {venue ? 'ticket' : 'item'}</Button>
      </form>
    </Card>
  )
}

function Hours({ hours, onSaved }: { hours: { open: string; close: string }; onSaved: () => void }) {
  const [open, setOpen] = useState(hours.open)
  const [close, setClose] = useState(hours.close)
  const [note, setNote] = useState('')
  const changed = open !== hours.open || close !== hours.close
  const cell = 'rounded-full bg-fill px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-iris'
  return (
    <Card>
      <h3 className="font-semibold">Gate hours, Nairobi time</h3>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          api('/api/console/hours', { body: { open, close } }).then(() => { setNote('Saved.'); onSaved() }).catch((err) => setNote(err.message))
        }}
      >
        <input type="time" aria-label="Opens at" className={cell} value={open} onChange={(e) => setOpen(e.target.value)} />
        <span className="text-sm text-soft">to</span>
        <input type="time" aria-label="Closes at" className={cell} value={close} onChange={(e) => setClose(e.target.value)} />
        <Button tone="dark" disabled={!changed} className="!px-4 !py-2 text-sm">Save hours</Button>
      </form>
      <p className="mt-2 text-xs text-soft">{note || 'Tickets are sold while you’re open and stop working at closing time. A ticket already sold keeps the closing time it was sold with.'}</p>
    </Card>
  )
}

type Found = { id: string; paid: boolean; lines: Line[] | null; holder: string | null; gate_open: boolean; ticket: Ticket }

/** The gate: scan or type a ticket, see who it covers, let them in. */
function Gate({ orders, onDone }: { orders: OrderRow[]; onDone: () => void }) {
  const [id, setId] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string; tx?: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const tickets = orders.filter((o) => o.kind === 'Ticket' && o.status === 'paid' && o.invoice_id)

  const check = async (ticketId: string) => {
    const clean = ticketId.trim()
    if (clean.length < 3) return
    setId(clean)
    setBusy(true)
    setNote(null)
    setFound(null)
    try {
      setFound(await api<Found>(`/api/console/tickets/${encodeURIComponent(clean)}`))
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const admit = async (count?: number) => {
    if (!found) return
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; reason?: string; tx_hash?: string | null; ticket?: Ticket }>('/api/console/redeem', { body: { id: found.id, count } })
      setNote(r.ok ? { ok: true, text: `Let in. ${r.ticket!.admitted} of ${r.ticket!.admits} are now in.`, tx: r.tx_hash } : { ok: false, text: `Don’t admit: ${r.reason}.`, tx: r.tx_hash })
      setFound(null)
      setId('')
      onDone()
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const t = found?.ticket
  const left = t ? t.admits - t.admitted : 0

  return (
    <Card>
      <h2 className="text-xl font-bold">At the gate</h2>
      <form onSubmit={(e) => { e.preventDefault(); void check(id) }} className="mt-3 flex gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="tkt-…" aria-label="Ticket number" className="min-w-0 flex-1 rounded-full bg-fill px-4 py-2.5 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris" />
        <Button disabled={busy || id.trim().length < 3} className="!px-4 !py-2.5 text-sm">Check</Button>
      </form>
      <button type="button" onClick={() => setScanning(true)} className="mt-2 text-sm font-semibold text-iris hover:underline">Scan a ticket with the camera</button>
      {tickets.length > 0 && !found && (
        <p className="mt-2 text-xs text-soft">
          Sold recently:{' '}
          {tickets.slice(0, 5).map((o) => (
            <button key={o.id} type="button" onClick={() => check(o.invoice_id!)} className="mr-2 font-medium text-ink underline underline-offset-2 hover:no-underline">{o.invoice_id}</button>
          ))}
        </p>
      )}
      {found && t && (
        <div className={`mt-3 rounded-2xl p-4 ${t.state === 'valid' ? 'bg-good-wash' : t.state === 'expired' ? 'bg-amber-wash' : 'bg-fill'}`}>
          <p className={`text-lg font-bold ${t.state === 'valid' ? 'text-good' : t.state === 'expired' ? 'text-amber' : 'text-soft'}`}>
            {t.state === 'valid' ? `Valid: ${left} ${left === 1 ? 'person' : 'people'} to let in` : t.state === 'expired' ? 'Expired: don’t admit' : 'Already used: don’t admit'}
          </p>
          <p className="mt-0.5 text-sm">{found.holder ? `${found.holder}. ` : ''}{found.lines?.map((l) => `${l.qty} × ${l.name}`).join(', ')}</p>
          {t.admitted > 0 && t.state === 'valid' && <p className="text-xs text-soft">{t.admitted} of {t.admits} already in</p>}
          {t.state === 'valid' && (
            <p className={`mt-1 text-xs ${found.gate_open ? 'text-soft' : 'font-semibold text-amber'}`}>
              {found.gate_open ? '' : 'Your gate hours say you are closed now. '}
              This ticket was sold to work until {new Date(t.valid_until_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            </p>
          )}
          {t.state === 'valid' && (
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} onClick={() => admit()} className="flex-1 !py-2.5 text-sm">{left === 1 ? 'Let them in' : `Let all ${left} in`}</Button>
              {left > 1 && <Button tone="quiet" disabled={busy} onClick={() => admit(1)} className="!py-2.5 text-sm">Just one</Button>}
            </div>
          )}
        </div>
      )}
      {note && (
        <div className="mt-3"><Notice tone={note.ok ? 'good' : 'bad'}>{note.text} {note.tx && <TxLink hash={note.tx} />}</Notice></div>
      )}
      {scanning && <Scanner title="Scan a ticket" hint="Point the camera at the code on the customer’s ticket." onClose={() => setScanning(false)} onCode={(text) => { setScanning(false); void check(text) }} />}
    </Card>
  )
}

function Split({ splits, onSaved }: { splits: Data['splits']; onSaved: () => void }) {
  const pct = (name: string) => String((splits.find((s) => s.account_id.startsWith(name + '.'))?.bps ?? 0) / 100)
  const [savings, setSavings] = useState(pct('savings'))
  const [partner, setPartner] = useState(pct('partner'))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setNote(null)
    try {
      await api('/api/console/split', { body: { savings_percent: Number(savings) || 0, partner_percent: Number(partner) || 0 } })
      setNote({ ok: true, text: 'Saved. The next sale is split this way.' })
      onSaved()
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const field = 'num mt-1 w-full rounded-2xl bg-fill px-4 py-2.5 font-semibold outline-none focus:ring-2 focus:ring-iris'
  return (
    <Card>
      <h2 className="text-xl font-bold">Split every sale</h2>
      <p className="mt-1 text-sm text-soft">The contract divides each payment as it settles. Only you can change this, not your agent.</p>
      <form onSubmit={save} className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">To savings, %
            <input className={field} inputMode="decimal" value={savings} onChange={(e) => setSavings(e.target.value)} />
          </label>
          <label className="text-sm font-medium">To a partner, %
            <input className={field} inputMode="decimal" value={partner} onChange={(e) => setPartner(e.target.value)} />
          </label>
        </div>
        <Button tone="dark" disabled={busy} className="w-full !py-2.5 text-sm">{busy ? 'Saving…' : 'Save split'}</Button>
        {note && <Notice tone={note.ok ? 'good' : 'bad'}>{note.text}</Notice>}
      </form>
    </Card>
  )
}
