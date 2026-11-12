import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, type Limits, type Line, type Ticket } from '@shared/api'
import { Profile } from '@shared/Profile'
import { Scanner } from '@shared/Scanner'
import { Button, Card, EXPLORER_ACCOUNT, Meter, Money, Notice, Spinner, Tick, TxLink, fmt, when, Logo, ShopIcon, shopLook, usd } from '@shared/ui'
import Withdraw from '@shared/Withdraw'
import { HoursChart, Metric, Mix, Outcomes, SalesChart, type Day } from './Charts'
import { AgentPanel } from './AgentPanel'
import { ShopCode } from './ShopCode'

type Item = { sku: string; name: string; price: number; price_kes: number; tags: string[]; stock: number; reorder_at: number; restock_qty: number }
type OrderRow = { id: string; customer: string; party_size: number; goal: string; mode: string; status: string; invoice_id: string | null; kind: string | null; total: number | null; lines: Line[] | null; agents: string; at: string }
type Rule = { kind: 'total' | 'group' | 'time' | 'returning'; percent: number; min_kes?: number; people?: number; visits?: number; from?: string; to?: string; says: string }
type ChargeRow = { id: string; amount: number; amount_kes: number; note: string; at: string; taken: boolean }
type Data = {
  near_id: string; name: string; place: string; blurb: string; verified: boolean; agents: string
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

type ShopRef = { near_id: string; name: string; kind: string; status: string }
type Stats = { days: Day[]; hours: number[]; usual: number[]; today: Day; yesterday: Day; returning_today: number; top: { name: string; qty: number; amount: number }[]
  moves: { id: string; amount: number; at_ms: number; symbol: string; chain: string }[] }

/** Today against yesterday as a chip: a percentage when there is something to compare with. */
const against = (now: number, before: number): { up: boolean; text: string } | null =>
  before > 0 ? { up: now >= before, text: `${Math.abs(Math.round(((now - before) / before) * 100))}%` } : null
const average = (days: Day[]): number => {
  const n = days.reduce((a, x) => a + x.count, 0)
  return n ? Math.round(days.reduce((a, x) => a + x.sales, 0) / n) : 0
}

export default function Console({ isAdmin, shops, onSwitch }: { isAdmin: boolean; shops: ShopRef[]; onSwitch: (nearId: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [paying, setPaying] = useState(false) // the withdraw sheet
  const [moving, setMoving] = useState<string | null>(null)
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
  const loadStats = useCallback(() => api<Stats>('/api/console/stats').then(setStats).catch(() => {}), [])
  useEffect(() => {
    load()
    loadStats()
    const t = setInterval(() => load(true), 4000)
    const u = setInterval(loadStats, 30_000)
    return () => { clearInterval(t); clearInterval(u) }
  }, [load, loadStats])

  // A share the contract set aside under this shop (savings) goes back to the main balance.
  const sweep = async (accountId: string) => {
    if (moving) return
    setMoving(accountId)
    try {
      await api('/api/console/sweep', { body: { account_id: accountId } })
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setMoving(null)
      void load()
    }
  }

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
  const low = d.items.filter((i) => i.stock <= 5)
  const words = { sales: venue ? 'Ticket sales' : counter ? 'Sales' : 'Orders', catalogue: venue ? 'Tickets' : 'Menu and stock' }
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['sales', words.sales], ...(counter ? [] : [['catalogue', words.catalogue] as [Tab, string]]), ['plans', 'Subscriptions'], ['rules', 'Settings']]

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
      {/* A floating bar that stays in view: the mark, the sections as a pill, the shop you are in, your account. */}
      <div className="sticky top-3 z-20 px-3 print:hidden">
        <div className="frost mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 rounded-[28px] px-3 py-2 shadow-[0_10px_30px_rgb(12_14_18/0.10)] ring-1 ring-line md:rounded-full">
          <Logo size={34} />
          <nav aria-label="Console sections" className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1 md:justify-center [scrollbar-width:none]">
            {tabs.map(([id, text]) => (
              <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${tab === id ? 'bg-ink text-white' : 'text-soft hover:bg-fill hover:text-ink'}`}>{text}</button>
            ))}
            <Link to="/statement" className="shrink-0 rounded-full px-3.5 py-2 text-sm font-medium text-soft hover:bg-fill hover:text-ink">Daily statement</Link>
            {isAdmin && <Link to="/admin" className="shrink-0 rounded-full px-3.5 py-2 text-sm font-medium text-soft hover:bg-fill hover:text-ink">Admin</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Switcher shops={shops} current={d.near_id} onSwitch={onSwitch} />
            <Profile name={d.name} nearId={d.near_id} align="right" items={[{ label: 'Open the customer app', href: CUSTOMER_APP }]} />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-5 pb-14 pt-9">
        <ShopProfile d={d} onSaved={() => load()} />
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
            {live && paid.length === 0 && <FirstSteps kind={d.kind} hasPrices={counter || d.items.length > 0} onPrint={() => window.print()} />}

            {/* The four figures an owner looks at first. */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
              <Metric dark label="Balance" value={<Money micro={d.balance} className="[&>span:first-child]:text-white/60" />}
                note={<>{usd(d.balance)} sUSD on NEAR. {kept / 100}% of every sale stays here.</>}>
                <button type="button" disabled={d.balance < 1_000_000} onClick={() => setPaying(true)} className="mt-4 w-fit rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-fill disabled:opacity-40">Withdraw</button>
              </Metric>
              <Metric label="Today" value={stats ? <><span className="mr-1 text-base font-semibold text-soft">KES</span>{stats.today.sales.toLocaleString('en-US')}</> : '…'}
                note={stats ? `${stats.today.count} ${stats.today.count === 1 ? 'sale' : 'sales'}${stats.today.refunds ? `, KES ${stats.today.refunds.toLocaleString('en-US')} refunded` : ''}` : ''}
                change={stats ? against(stats.today.sales, stats.yesterday.sales) : null} trend={stats?.days.slice(-14).map((x) => x.sales)} />
              <Metric label="Average sale" value={stats ? <><span className="mr-1 text-base font-semibold text-soft">KES</span>{average(stats.days.slice(-14)).toLocaleString('en-US')}</> : '…'}
                note="Over the last 14 days" change={stats ? against(average([stats.today]), average([stats.yesterday])) : null}
                trend={stats?.days.slice(-14).map((x) => (x.count ? x.sales / x.count : 0))} />
              <Metric label="Customers today" value={stats ? stats.today.customers : '…'}
                note={stats ? (stats.today.customers ? `${stats.returning_today} had paid here before` : 'Nobody has paid yet today') : ''}
                change={stats && (stats.today.customers || stats.yesterday.customers) ? { up: stats.today.customers >= stats.yesterday.customers, text: String(Math.abs(stats.today.customers - stats.yesterday.customers)) } : null}
                trend={stats?.days.slice(-14).map((x) => x.customers)} />
            </div>

            {/* Money the contract set aside, and what matters for this kind of shop. */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
              {d.splits.map((x) => (
                <Metric key={x.account_id} label={x.account_id.split('.')[0].replace(/^./, (c) => c.toUpperCase())} value={<Money micro={x.balance} />} note={`${x.bps / 100}% of every sale, split by the contract`}>
                  {x.account_id.endsWith('.' + d.near_id) && x.balance > 0 && (
                    <button type="button" disabled={moving !== null} onClick={() => sweep(x.account_id)} className="mt-3 w-fit rounded-full bg-fill px-3 py-1.5 text-xs font-semibold hover:bg-line disabled:opacity-50">
                      {moving === x.account_id ? 'Moving…' : 'Move to balance'}
                    </button>
                  )}
                </Metric>
              ))}
              {venue && <Metric label="Recent ticket sales" value={<>{people} <span className="text-base font-semibold text-soft">{people === 1 ? 'person' : 'people'}</span></>} note={`On ${sold.length} ${sold.length === 1 ? 'ticket' : 'tickets'}. Each paid from their own phone, with no phone number given at the gate.`} />}
              {counter && <Metric label="Recent sales" value={<>{paid.length} <span className="text-base font-semibold text-soft">paid</span></>} note="You key in the amount, the customer scans, their agent pays." />}
              {d.kind === 'food' && (
                <>
                  <Metric label="Running low" value={<>{low.length} <span className="text-base font-semibold text-soft">{low.length === 1 ? 'item' : 'items'}</span></>}
                    note={low.length ? low.slice(0, 3).map((i) => `${i.name} (${i.stock})`).join(', ') : 'Everything has more than 5 in stock'} />
                  <section className="rounded-3xl bg-card p-5 sm:col-span-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm text-soft">Your agent can spend today</p>
                      <p className="num text-sm"><span className="font-semibold">{lim ? fmt(Math.max(0, lim.per_day - lim.spent_in_window)) : fmt(0)}</span> <span className="text-soft">of {lim ? fmt(lim.per_day) : fmt(0)}</span></p>
                    </div>
                    <div className="mt-3"><Meter used={lim?.spent_in_window ?? 0} max={lim?.per_day ?? 0} /></div>
                    <p className="mt-3 text-xs text-soft">
                      {d.supplier ? <>It restocks from {d.supplier.name} on its own, up to <span className="num">{lim ? fmt(lim.per_payment) : fmt(0)}</span> a purchase. </> : 'No supplier is connected yet, so your agent doesn’t restock. '}
                      It can’t withdraw, raise these limits or change the split.
                    </p>
                  </section>
                </>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] print:hidden">
              <Card>{stats ? <SalesChart days={stats.days} /> : <div className="skeleton h-80" />}</Card>
              <Card>{stats ? <HoursChart hours={stats.hours} usual={stats.usual} /> : <div className="skeleton h-64" />}</Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2 print:hidden">
              <Card>{stats ? <Mix items={stats.top} unit={venue ? 'tickets' : 'sold'} /> : <div className="skeleton h-40" />}</Card>
              <Card>{stats ? <Outcomes days={stats.days} /> : <div className="skeleton h-40" />}</Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6 print:hidden">
                {counter && live && <Charge charges={d.charges} shopId={d.near_id} shopName={d.name} onDone={() => load()} />}
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
                  <Card className="text-center print:!bg-white print:shadow-none">
                    <h2 className="text-xl font-bold print:text-5xl">{venue ? 'Scan to get your ticket' : counter ? 'Scan to pay' : 'Scan to order'}</h2>
                    {/* The code in its frame: the shop's name and checkmark above, the mark below. A plain sticker has neither. */}
                    <a href={code} target="_blank" rel="noreferrer" aria-label="Open this code as a customer" className="mx-auto mt-4 block w-fit rounded-[30px] p-3 ring-1 ring-line print:mt-8 print:ring-2" style={{ background: shopLook(d.name).tint }}>
                      <span className="flex items-center justify-center gap-1.5 px-2 pb-2.5 pt-1 text-sm font-bold print:text-2xl" style={{ color: shopLook(d.name).ink }}>{d.name} <Tick /></span>
                      <span className="block print:hidden"><ShopCode value={code} name={d.name} size={212} /></span>
                      <span className="hidden print:block"><ShopCode value={code} name={d.name} size={420} /></span>
                      <span className="flex items-center justify-center gap-1.5 pb-0.5 pt-2.5 text-xs font-semibold text-soft print:text-base"><img src="/sokonipay-logo.png" alt="" width={16} height={16} className="mix-blend-multiply" />Verified on SokoniPay</span>
                    </a>
                    <p className="mt-3 text-sm text-soft print:mt-8 print:text-xl print:text-ink">
                      <span className="hidden print:inline">Point your phone’s camera here. Your agent pays {d.name} inside the limits you set. No phone number, no queue.</span>
                      <span className="print:hidden">
                        {d.kind === 'food'
                          ? 'This code changes every 10 seconds. An order through it proves the customer is at your stall. No location is collected.'
                          : `This code only says who you are. It takes no payment and doesn’t change, so you can print it for the ${venue ? 'gate' : 'counter'}.`}
                      </span>
                    </p>
                    <div className="mt-3 flex justify-center gap-2 print:hidden">
                      {d.kind !== 'food' && <Button tone="quiet" onClick={() => window.print()} className="!py-2 text-sm">Print the poster</Button>}
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
      <AgentPanel shop={d.name} />
      {paying && (
        <div className="print:hidden">
          <Withdraw balance={d.balance} path="/api/console/withdraw" whose="the shop’s" onClose={() => setPaying(false)} onDone={() => { void load(); void loadStats() }} />
        </div>
      )}
    </div>
  )
}

/** Which shop you are in, and the way to another or a new one. */
function Switcher({ shops, current, onSwitch }: { shops: ShopRef[]; current: string; onSwitch: (nearId: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const mine = shops.find((x) => x.near_id === current)
  const look = shopLook(mine?.name ?? '')
  const words: Record<string, string> = { venue: 'Venue', food: 'Food stall', counter: 'Counter' }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="flex max-w-[13rem] items-center gap-2 rounded-full bg-fill py-1.5 pl-1.5 pr-3 text-sm font-medium hover:bg-line">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[11px] font-bold" style={{ background: look.tint, color: look.ink }}>{look.initials}</span>
        <span className="truncate">{mine?.name}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
      </button>
      {open && (
        <div role="menu" className="rise absolute right-0 top-full z-30 mt-2 w-72 rounded-3xl bg-card p-2 shadow-[0_16px_40px_rgb(12_14_18/0.18)] ring-1 ring-line">
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-soft">Your shops</p>
          {shops.map((x) => (
            <button key={x.near_id} role="menuitem" type="button" onClick={() => { setOpen(false); onSwitch(x.near_id) }} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-fill ${x.near_id === current ? 'bg-canvas' : ''}`}>
              <ShopIcon name={x.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{x.name}</span>
                <span className="block text-xs text-soft">{words[x.kind] ?? x.kind}{x.status === 'approved' ? '' : x.status === 'pending' ? ', waiting to be verified' : ', suspended'}</span>
              </span>
              {x.near_id === current && <span className="h-2 w-2 shrink-0 rounded-full bg-iris" aria-label="Current" />}
            </button>
          ))}
          <div className="mx-3 my-1 border-t border-line" />
          {shops.length < 5
            ? <Link to="/new" role="menuitem" className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold hover:bg-fill"><span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-fill text-xl">+</span>Open another shop</Link>
            : <p className="px-3 py-2 text-xs text-soft">Five shops is the most one account can have.</p>}
        </div>
      )}
    </div>
  )
}

/** What a newly verified shop does next. It goes away after the first sale. */
function FirstSteps({ kind, hasPrices, onPrint }: { kind: Data['kind']; hasPrices: boolean; onPrint: () => void }) {
  const steps: [string, boolean, string][] = [
    [kind === 'counter' ? 'Your counter is set up' : 'Your prices are set', hasPrices, ''],
    ['SokoniPay has verified you', true, ''],
    [kind === 'food' ? 'Keep this page open where customers can scan it' : 'Print your poster and put it up', false, kind === 'food' ? '' : 'Print'],
    ['Make a test sale: click your code to open it as a customer', false, ''],
  ]
  return (
    <div className="rounded-3xl bg-card p-5 print:hidden">
      <h2 className="text-xl font-bold">You’re open. Two things left</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([text, done, action], n) => (
          <li key={n} className="flex items-start gap-3 rounded-2xl bg-canvas p-3 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? 'bg-good text-white' : 'bg-card text-soft ring-1 ring-line'}`}>{done ? '✓' : n + 1}</span>
            <span>{text}{action && <button type="button" onClick={onPrint} className="ml-2 font-semibold text-iris hover:underline">{action}</button>}</span>
          </li>
        ))}
      </ol>
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
function Charge({ charges, shopId, shopName, onDone }: { charges: ChargeRow[]; shopId: string; shopName: string; onDone: () => void }) {
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
                {i === 0 && <a href={link} target="_blank" rel="noreferrer" aria-label="Open this amount as a customer" className="rounded-xl bg-white p-2"><ShopCode value={link} name={shopName} size={132} /></a>}
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

const KINDS: Record<string, string> = { venue: 'Park or venue', food: 'Food and drink', counter: 'Pay at the counter' }
const PIN = 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z'
const CLOCK = 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5v4.8l3 1.8'
const SHIELD = 'M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6zM9 12l2.2 2.2L15.2 10'
function Icon({ d }: { d: string }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-soft"><path d={d} /></svg>
}

/**
 * The shop as its customers see it, at the top of the console: who it is, where and when. "Edit" turns the
 * same card into a form, so the owner changes exactly what a customer reads.
 */
function ShopProfile({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const venue = d.kind === 'venue'
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(d.blurb)
  const [where, setWhere] = useState(d.place)
  const [timed, setTimed] = useState(venue || !!d.hours)
  const [open, setOpen] = useState(d.hours?.open ?? '08:00')
  const [close, setClose] = useState(d.hours?.close ?? '18:00')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const look = shopLook(d.name)
  const begin = () => { setText(d.blurb); setWhere(d.place); setTimed(venue || !!d.hours); setOpen(d.hours?.open ?? '08:00'); setClose(d.hours?.close ?? '18:00'); setError(''); setEditing(true) }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/console/about', { body: { blurb: text.trim(), place: where.trim(), hours: timed ? { open, close } : null } })
      setEditing(false)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const field = 'mt-1 w-full rounded-2xl bg-fill px-4 py-2.5 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'
  const cell = 'rounded-full bg-fill px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-iris'
  const hoursLine = !d.hours ? '' : d.hours.open === '00:00' && d.hours.close === '23:59' ? 'Open all day' : `${d.hours.open} to ${d.hours.close}`
  return (
    <section className="frost rounded-3xl p-5 ring-1 ring-line print:hidden" aria-label="Your shop as customers see it">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] text-xl font-extrabold" style={{ background: look.tint, color: look.ink }}>{look.initials}</span>
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight">{d.name}{d.verified && <>{'\u00A0'}<Tick size={24} /></>}</h1>
            {!d.verified && (d.status === 'suspended'
              ? <span className="rounded-full bg-bad-wash px-2.5 py-1 text-xs font-semibold text-bad">Suspended</span>
              : <span className="rounded-full bg-amber-wash px-2.5 py-1 text-xs font-semibold text-amber">Not verified yet</span>)}
          </div>
          <p className="text-sm text-soft">{KINDS[d.kind]}{d.kind === 'food' ? ` · Agent: ${d.agents}` : ''}</p>

          {editing ? (
            <form onSubmit={save} className="mt-4 max-w-2xl space-y-4">
              <label className="block text-sm font-medium">Who you are and what you offer
                <textarea autoFocus className={`${field} resize-none`} rows={3} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="A 30-hectare forest park in the city. Walking trails, picnic lawns and over 350 tree species." />
                <span className="num mt-1 block text-right text-xs font-normal text-soft">{text.length} of 200</span>
              </label>
              <label className="block text-sm font-medium">Where customers find you
                <input className={field} maxLength={120} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="State House Road, Nairobi" />
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Opening hours, Nairobi time</legend>
                {!venue && (
                  <label className="mt-1.5 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="h-4 w-4 accent-[var(--color-iris)]" />
                    Show opening hours on my page
                  </label>
                )}
                {timed && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="time" aria-label="Opens at" className={cell} value={open} onChange={(e) => setOpen(e.target.value)} />
                    <span className="text-sm text-soft">to</span>
                    <input type="time" aria-label="Closes at" className={cell} value={close} onChange={(e) => setClose(e.target.value)} />
                  </div>
                )}
                <p className="mt-2 text-xs text-soft">{venue ? 'Tickets are sold while you’re open and stop working at closing time. A ticket already sold keeps the closing time it was sold with.' : 'Shown to customers. Orders are still taken outside these hours.'}</p>
              </fieldset>
              {error && <Notice>{error}</Notice>}
              <div className="flex gap-2">
                <Button tone="dark" disabled={busy} className="!px-5 !py-2.5 text-sm">{busy ? 'Saving…' : 'Save'}</Button>
                <Button type="button" tone="quiet" onClick={() => setEditing(false)} className="!px-5 !py-2.5 text-sm">Cancel</Button>
              </div>
            </form>
          ) : (
            <>
              {d.blurb ? <p className="mt-3 max-w-2xl leading-relaxed">{d.blurb}</p>
                : <button type="button" onClick={begin} className="mt-3 rounded-2xl border border-dashed border-line px-4 py-2.5 text-left text-sm text-soft hover:border-soft hover:text-ink">Add a short description: who you are and what you offer. Customers read it before your prices.</button>}
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <li className="flex items-center gap-2"><Icon d={PIN} />{d.place || <span className="text-soft">No place given</span>}</li>
                {hoursLine && <li className="flex items-center gap-2"><Icon d={CLOCK} />{venue && <span className={d.open ? 'font-medium text-good' : 'text-soft'}>{d.open ? 'Open now' : 'Closed now'}</span>}<span className="text-soft">{hoursLine}</span></li>}
                <li className="flex min-w-0 items-center gap-2"><Icon d={SHIELD} /><a href={EXPLORER_ACCOUNT + d.near_id} target="_blank" rel="noreferrer" className="truncate text-soft hover:underline">{d.near_id}</a></li>
              </ul>
            </>
          )}
        </div>
        {!editing && <Button tone="quiet" onClick={begin} className="!px-4 !py-2 text-sm">Edit</Button>}
      </div>
    </section>
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
