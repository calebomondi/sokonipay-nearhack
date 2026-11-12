import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, type Limits, type ReceiptData, type Ticket } from '@shared/api'
import { Profile } from '@shared/Profile'
import { TicketPass } from '@shared/TicketPass'
import { Button, Card, Meter, Money, Notice, ShopIcon, Tick, first, fmt, kesToMicro, toKes, when } from '@shared/ui'
import { Scanner } from '@shared/Scanner'
import AddMoney from './AddMoney'
import Chat from './Chat'
import Subs from './Subs'
import Withdraw from '@shared/Withdraw'

type Row = { id: string; shop: string; kind: string; status: string; total: number; my_share: number | null; paid_at_ms: number | null; refunded_at_ms: number | null; subscription: string | null; ticket: Ticket | null }
type Wallet = {
  near_id: string; name: string; balance: number; limits: Limits | null; receipts: Row[]
  shops_used: { near_id: string; times: number; last: string }[]
  added: { id: string; amount: number; at_ms: number; symbol: string; chain: string; demo: boolean; out: boolean }[]
}
/** One line that moved the balance. `amount` is signed: negative is money out. */
type Move = { key: string; at: number; amount: number; title: string; note: string; shop: boolean; to: string | null; ticket: boolean }
type ShopRow = { near_id: string; name: string; blurb: string; place: string; verified: boolean; kind: string; open: boolean }
type TicketKind = 'active' | 'used' | 'expired' | 'refunded'
const kindOf = (r: Row): TicketKind => (r.status === 'Refunded' ? 'refunded' : r.ticket?.state === 'used' ? 'used' : r.ticket?.state === 'expired' ? 'expired' : 'active')
// One colour per state, the same ones the full pass uses, so a glance is enough.
const LOOKS: Record<TicketKind, { box: string; word: string; icon: string }> = {
  active: { box: 'bg-good text-white', word: 'Active', icon: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5zM9.2 12.2l2 2 3.8-4' },
  used: { box: 'bg-[#9aa1ad] text-white', word: 'Used', icon: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5zM9 12h6' },
  expired: { box: 'bg-amber text-white', word: 'Expired', icon: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM12 8v4.3l2.6 1.7' },
  refunded: { box: 'bg-[#5b6b8c] text-white', word: 'Refunded', icon: 'M9 7 5 11l4 4M5 11h9a5 5 0 0 1 0 10h-2' },
}
type Tab = 'home' | 'tickets' | 'subs' | 'chat' | 'activity' | 'shops'

// Shops is a page reached from Home, not a tab in the bar.
const TITLES: Record<Tab, string> = { home: 'Home', tickets: 'Tickets', subs: 'Subscriptions', chat: 'Your agent', activity: 'Activity', shops: 'Shops' }
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'M3.5 10.6 12 3.6l8.5 7M5.5 9.2V19A1.5 1.5 0 0 0 7 20.5h2.75v-5a2.25 2.25 0 0 1 4.5 0v5H17a1.5 1.5 0 0 0 1.5-1.5V9.2' },
  { id: 'tickets', label: 'Tickets', icon: 'M3.5 8A2.5 2.5 0 0 1 6 5.5h12A2.5 2.5 0 0 1 20.5 8v1.6a2.4 2.4 0 0 0 0 4.8V16a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 16v-1.6a2.4 2.4 0 0 0 0-4.8zM14.5 8.4v1.4M14.5 11.9v1.4M14.5 15.4v.6' },
  { id: 'subs', label: 'Subs', icon: 'M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9M17.9 3.6v3.6h-3.6M6.1 20.4v-3.6h3.6' },
  { id: 'chat', label: 'Chat', icon: 'M5 5.5h14A1.5 1.5 0 0 1 20.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-6.3l-4.2 3v-3H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5zM8.5 10h7M8.5 13.2h4.5' },
  { id: 'activity', label: 'Activity', icon: 'M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5zM9 8.5h6M9 12h6M9 15.5h3' },
]

const MERCHANT_APP = (import.meta.env.VITE_MERCHANT_APP_URL as string | undefined) ?? 'http://localhost:5174'

// What was on screen last time, so coming back from a shop paints at once while fresh data loads.
let lastWallet: Wallet | null = null
let lastShops: ShopRow[] | null = null

export default function Home({ hasShop }: { hasShop: boolean }) {
  const navigate = useNavigate()
  const { tab: param } = useParams()
  const tab: Tab = param && param in TITLES ? (param as Tab) : 'home'
  const [wallet, setWallet] = useState<Wallet | null>(lastWallet)
  const [shops, setShops] = useState<ShopRow[] | null>(lastShops)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<'scan' | 'limits' | 'add' | 'out' | null>(null)
  const [find, setFind] = useState('')
  const [show, setShow] = useState<'all' | 'tickets' | 'orders' | 'in' | 'out'>('all')
  const [opened, setOpened] = useState<string | null>(null)
  const [kind, setKind] = useState<'all' | TicketKind>('all')

  const load = useCallback(() => api<Wallet>('/api/wallet').then((w) => { lastWallet = w; setWallet(w) }).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load()
    api<ShopRow[]>('/api/shops').then((x) => { lastShops = x; setShops(x) }).catch((e) => setError(e.message))
  }, [load])

  const openCode = (text: string) => {
    setSheet(null)
    try {
      const u = new URL(text, location.origin)
      const shop = u.searchParams.get('m')
      if (shop) return navigate(`/shop/${shop}${u.searchParams.get('p') ? `?p=${u.searchParams.get('p')}` : u.searchParams.get('c') ? `?c=${u.searchParams.get('c')}` : ''}`)
    } catch {
      /* not a link */
    }
    setError('That code isn’t a SokoniPay shop. Check the sticker with the shop before paying.')
  }

  const profile = wallet && (
    <Profile name={wallet.name} nearId={wallet.near_id} items={[
      { label: 'Agent limits', onClick: () => setSheet('limits') },
      { label: 'Add money', onClick: () => setSheet('add') },
      { label: 'Withdraw', onClick: () => setSheet('out') },
      ...(hasShop ? [{ label: 'Open my shop', href: MERCHANT_APP }] : []),
    ]} />
  )

  if (!wallet) return error ? <div className="flex min-h-dvh items-center justify-center p-5"><Notice>{error}</Notice></div> : <Loading />
  const lim = wallet.limits
  const left = lim ? Math.max(0, lim.per_day - lim.spent_in_window) : 0
  const tickets = wallet.receipts.filter((r) => r.kind === 'Ticket')
  const live = tickets.filter((r) => r.status === 'Paid' && r.ticket?.state === 'valid')
  const past = tickets.filter((r) => !live.includes(r))
  const count = (k: TicketKind) => tickets.filter((r) => kindOf(r) === k).length
  const picked = [...live, ...past].filter((r) => kind === 'all' || kindOf(r) === kind)

  // The shop paid most recently comes first, then the ones paid most often, then the rest.
  const used = new Map(wallet.shops_used.map((u) => [u.near_id, u]))
  const latest = [...wallet.shops_used].sort((a, b) => b.last.localeCompare(a.last))[0]?.near_id
  const rank = (s: ShopRow) => (s.near_id === latest ? 1e9 : 0) + (used.get(s.near_id)?.times ?? 0)
  const sorted = [...(shops ?? [])].sort((a, b) => rank(b) - rank(a))
  const wanted = find.trim().toLowerCase()
  const found = wanted ? sorted.filter((s) => `${s.name} ${s.place} ${s.blurb}`.toLowerCase().includes(wanted)) : sorted

  // Everything that moved the balance, newest first: payments out, refunds and money added in.
  const moves: Move[] = [
    ...wallet.receipts.map((r): Move => ({
      key: r.id, at: r.paid_at_ms ?? 0, amount: -(r.my_share ?? r.total), title: r.shop, shop: true, to: `/r/${r.id}`, ticket: r.kind === 'Ticket',
      note: r.kind === 'Ticket' ? `Entry ticket${r.status === 'Paid' && r.ticket && r.ticket.state !== 'valid' ? `, ${r.ticket.state}` : ''}` : r.kind === 'Group' ? 'Your share of a split bill' : r.subscription ? r.subscription.replace(/ subscription$/, ', subscription') : 'Order',
    })),
    ...wallet.receipts.filter((r) => r.status === 'Refunded').map((r): Move => ({
      key: 'back-' + r.id, at: r.refunded_at_ms ?? r.paid_at_ms ?? 0, amount: r.my_share ?? r.total, title: r.shop, shop: true, to: `/r/${r.id}`, ticket: r.kind === 'Ticket',
      note: r.kind === 'Ticket' ? 'Ticket refunded' : 'Refund',
    })),
    ...wallet.added.map((a): Move => ({
      key: a.id, at: a.at_ms, amount: a.out ? -a.amount : a.amount, title: a.out ? 'Withdrawal' : 'Money added', shop: false, to: null, ticket: false,
      note: a.out ? `Demo, priced as ${a.symbol} on ${a.chain}` : a.demo ? `Demo money, priced as ${a.symbol} on ${a.chain}` : `${a.symbol} from ${a.chain}`,
    })),
  ].sort((a, b) => b.at - a.at)
  const shown = moves.filter((m) => show === 'all' || (show === 'in' ? m.amount > 0 : show === 'out' ? m.amount < 0 && !m.shop : show === 'tickets' ? m.ticket : m.amount < 0 && !m.ticket && m.shop))

  const sheets = (
    <>
      {sheet === 'scan' && <Scanner onCode={openCode} onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddMoney onClose={() => setSheet(null)} onAdded={load} />}
      {sheet === 'out' && <Withdraw balance={wallet.balance} onClose={() => setSheet(null)} onDone={load} />}
      {sheet === 'limits' && lim && <LimitsSheet limits={lim} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load() }} />}
    </>
  )

  // Chat takes the whole column: no bottom bar, the box to type in at the very bottom, and the tabs in a drawer on the left.
  if (tab === 'chat') {
    return (
      <main className="panel frame mx-auto flex w-full max-w-md flex-col px-4">
        <Chat onPaid={load} />
        <Drawer tab={tab} ready={live.length} />
        {sheets}
      </main>
    )
  }

  return (
    <main className="panel frame mx-auto flex w-full max-w-md flex-col px-4">
      {/* The header, and on Home the balance, never scroll. */}
      <div className="relative z-20 space-y-3 pb-3 pt-4">
      <header className="flex items-center gap-3">
        {tab === 'home' ? (
          <>
            {profile}
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight">Hi, {first(wallet.name)}</p>
              <p className="truncate text-xs text-soft">{wallet.near_id}</p>
            </div>
          </>
        ) : (
          <>
            <h1 className="flex-1 text-3xl font-extrabold tracking-tight">{TITLES[tab]}</h1>
            <p className="num text-sm font-semibold text-soft">{fmt(wallet.balance)}</p>
          </>
        )}
      </header>
        {tab === 'tickets' && (
          <Chips label="Show tickets" value={kind} onPick={setKind} options={[
            ['all', 'All', tickets.length], ['active', 'Active', count('active')], ['used', 'Used', count('used')],
            ['expired', 'Expired', count('expired')], ['refunded', 'Refunded', count('refunded')]]} />
        )}
        {tab === 'activity' && (
          <Chips label="Show" value={show} onPick={setShow} options={[['all', 'All'], ['tickets', 'Tickets'], ['orders', 'Orders'], ['in', 'Money in'], ['out', 'Withdrawn']]} />
        )}
        {tab === 'shops' && (
          <div className="flex gap-2">
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a shop or place" aria-label="Find a shop or place" className="min-w-0 flex-1 rounded-full bg-card px-4 py-3 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris" />
            <Button tone="dark" onClick={() => setSheet('scan')} className="!px-4 text-sm">Scan</Button>
          </div>
        )}
        {tab === 'home' && (
          <Card className="!p-4 text-center">
            <p className="text-xs font-medium text-soft">Balance</p>
            <p className="mt-0.5 text-4xl font-extrabold leading-none tracking-tight"><Money micro={wallet.balance} dollars /></p>
            <div className="mt-3 grid grid-cols-4 gap-1">
              <Action label="Scan" onClick={() => setSheet('scan')}>
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" />
              </Action>
              <Action label="Add money" onClick={() => setSheet('add')}>
                <path d="M12 5v14M5 12h14" />
              </Action>
              <Action label="Withdraw" onClick={() => setSheet('out')}>
                <path d="M12 19V5M6 11l6-6 6 6" />
              </Action>
              <Action label="Limits" onClick={() => setSheet('limits')}>
                <path d="M5 7h14M5 12h14M5 17h14M9 5v4M15 10v4M11 15v4" />
              </Action>
            </div>
          </Card>
        )}
      </div>

      <div className="scroll -mx-4 flex flex-col gap-4 px-4 pb-28 pt-1">
      {error && <Notice>{error}</Notice>}

      {tab === 'home' && (
        <>
          {live.length > 0 && (
            <section>
              <Heading title="Ready to show" to={live.length > 1 || past.length > 0 ? '/tickets' : undefined} more="All tickets" />
              <TicketRow r={live[0]} open={opened === live[0].id} onToggle={() => setOpened(opened === live[0].id ? null : live[0].id)} />
            </section>
          )}

          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">Agent spend limit today</h2>
              <p className="num text-sm"><span className="font-semibold">{fmt(left)}</span> <span className="text-soft">of {fmt(lim?.per_day ?? 0)}</span></p>
            </div>
            <div className="mt-3"><Meter used={lim?.spent_in_window ?? 0} max={lim?.per_day ?? 0} /></div>
            <p className="mt-3 text-sm text-soft">Up to <span className="num font-medium text-ink">{fmt(lim?.per_payment ?? 0)}</span> per payment.</p>
          </Card>

          <section>
            <Heading title="Shops" to="/shops" more="All shops" />
            <Card className="!p-0"><ShopList shops={shops === null ? null : sorted.slice(0, 4)} used={used} empty="No shops yet. A shop appears here once SokoniPay has verified it. If you’re at one, scan its code." /></Card>
          </section>

          <section>
            <Heading title="Recent payments" to={moves.length > 5 ? '/activity' : undefined} more="View all" />
            <Card className="!p-0"><Moves rows={moves.slice(0, 5)} empty="Nothing yet. Pick a shop and tell your agent what you want." /></Card>
          </section>
        </>
      )}

      {tab === 'tickets' && (
        <>
          {picked.length === 0 && (
            <Card><p className="text-sm text-soft">
              {kind === 'all' ? 'No tickets yet. Scan the code at a gate, or pick a venue under Shops, and your ticket appears here.' : `No ${kind} tickets.`}
            </p></Card>
          )}
          <ul className="space-y-2">
            {picked.map((r) => <li key={r.id}><TicketRow r={r} open={opened === r.id} onToggle={() => setOpened(opened === r.id ? null : r.id)} /></li>)}
          </ul>
        </>
      )}

      {tab === 'shops' && (
        <>
          <Card className="!p-0"><ShopList shops={shops === null ? null : found} used={used} empty={wanted ? 'No shop matches that. If you’re at the shop, scan its code.' : 'No shops yet. A shop appears here once SokoniPay has verified it.'} /></Card>
        </>
      )}

      {tab === 'subs' && <Subs onChanged={load} onAddMoney={() => setSheet('add')} />}

      {tab === 'activity' && (
        <>
          {shown.length === 0 && <Card><p className="text-sm text-soft">Nothing here yet.</p></Card>}
          {days(shown).map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 px-1 text-sm font-semibold text-soft">{day}</h2>
              <Card className="!p-0"><Moves rows={rows} empty="" timeOnly /></Card>
            </section>
          ))}
          <p className="px-1 text-xs text-soft">Payments are read from the SokoniPay contract on NEAR.</p>
        </>
      )}
      </div>

      {/* Pinned to the bottom of the frame. The list fades out behind it. */}
      <nav aria-label="Sections" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-canvas via-canvas/80 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8">
        <ul className="pointer-events-auto flex gap-1 rounded-full bg-card/95 p-1.5 shadow-[0_10px_30px_rgb(12_14_18/0.16)] ring-1 ring-line backdrop-blur">
          {TABS.map((t) => {
            const on = tab === t.id
            return (
              <li key={t.id}>
                <Link to={t.id === 'home' ? '/' : `/${t.id}`} aria-current={on ? 'page' : undefined}
                  className={`flex min-w-[3.6rem] flex-col items-center gap-0.5 rounded-full px-3 py-2 text-[11px] font-semibold transition-colors ${on ? 'bg-iris/10 text-iris' : 'text-soft hover:text-ink'}`}>
                  <span className="relative">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} fillOpacity={0.16} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.icon} /></svg>
                    {t.id === 'tickets' && live.length > 0 && <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-good" />}
                  </span>
                  {t.label}
                  {t.id === 'tickets' && live.length > 0 && <span className="sr-only">, {live.length} ready</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {sheets}
    </main>
  )
}

/** The tabs, tucked behind a handle on the left edge. Tap or pull the handle to bring them out. */
function Drawer({ tab, ready }: { tab: Tab; ready: number }) {
  const [open, setOpen] = useState(false)
  const from = useRef<number | null>(null)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])
  // A pull of a finger's width in the right direction opens or closes it; a plain tap toggles it.
  const pull = {
    onPointerDown: (e: React.PointerEvent) => { from.current = e.clientX; (e.target as Element).setPointerCapture?.(e.pointerId) },
    onPointerUp: (e: React.PointerEvent) => {
      const moved = from.current === null ? 0 : e.clientX - from.current
      from.current = null
      setOpen(Math.abs(moved) < 12 ? !open : moved > 0)
    },
  }
  return (
    <>
      {open && <button type="button" aria-label="Close the menu" onClick={() => setOpen(false)} className="absolute inset-0 z-30 cursor-default bg-ink/25" />}
      <div className={`absolute left-0 top-1/2 z-40 flex -translate-y-1/2 items-center transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-[4.75rem]'}`}>
        <nav aria-label="Sections" aria-hidden={!open} className="w-[4.75rem] rounded-r-3xl bg-card py-2 shadow-[0_10px_30px_rgb(12_14_18/0.18)] ring-1 ring-line">
          <ul className="flex flex-col gap-1 px-1.5">
            {TABS.map((t) => {
              const on = tab === t.id
              return (
                <li key={t.id}>
                  <Link to={t.id === 'home' ? '/' : `/${t.id}`} tabIndex={open ? 0 : -1} aria-current={on ? 'page' : undefined} onClick={() => setOpen(false)}
                    className={`flex flex-col items-center gap-0.5 rounded-2xl py-2.5 text-[11px] font-semibold ${on ? 'bg-iris/10 text-iris' : 'text-soft hover:bg-fill hover:text-ink'}`}>
                    <span className="relative">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} fillOpacity={0.16} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.icon} /></svg>
                      {t.id === 'tickets' && ready > 0 && <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-good" />}
                    </span>
                    {t.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <button type="button" {...pull} aria-expanded={open} aria-label={open ? 'Hide the menu' : 'Show the menu'}
          className="flex h-20 w-5 touch-none items-center justify-center rounded-r-2xl bg-card shadow-[4px_0_14px_rgb(12_14_18/0.12)] ring-1 ring-line">
          <span className="h-9 w-1 rounded-full bg-line" />
        </button>
      </div>
    </>
  )
}

/** Group by day, newest first: Today, Yesterday, then dates. */
function days(rows: Move[]): [string, Move[]][] {
  const name = (ms: number) => {
    const d = new Date(ms).toDateString()
    if (d === new Date().toDateString()) return 'Today'
    if (d === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday'
    return new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  }
  const out: [string, Move[]][] = []
  for (const r of rows) {
    const day = name(r.at)
    if (out.at(-1)?.[0] === day) out.at(-1)![1].push(r)
    else out.push([day, [r]])
  }
  return out
}

function Loading() {
  return (
    <main className="mx-auto flex panel w-full max-w-md flex-col gap-4 px-4 pt-5" aria-busy="true" aria-label="Loading your account">
      <div className="flex items-center gap-3"><div className="skeleton h-11 w-11 !rounded-full" /><div className="skeleton h-5 w-32" /></div>
      <div className="skeleton h-52 !rounded-3xl" />
      <div className="skeleton h-28 !rounded-3xl" />
      <div className="skeleton h-5 w-24" />
      <div className="skeleton h-40 !rounded-3xl" />
    </main>
  )
}

/** A row of filter pills. */
function Chips<K extends string>({ label, value, onPick, options }: { label: string; value: K; onPick: (k: K) => void; options: [K, string, number?][] }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" role="group" aria-label={label}>
      {options.map(([k, text, n]) => (
        <button key={k} aria-pressed={value === k} onClick={() => onPick(k)} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${value === k ? 'bg-ink text-white' : 'bg-card hover:bg-line'}`}>
          {text}{n !== undefined && <span className={`num ml-1.5 ${value === k ? 'opacity-70' : 'text-soft'}`}>{n}</span>}
        </button>
      ))}
    </div>
  )
}

function Heading({ title, to, more }: { title: string; to?: string; more?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <h2 className="text-lg font-bold">{title}</h2>
      {to && <Link to={to} className="text-sm font-semibold text-iris hover:underline">{more}</Link>}
    </div>
  )
}

/** A ticket in a list. Tapping it opens the full pass right underneath, and whatever follows slides down. */
function TicketRow({ r, open, onToggle }: { r: Row; open: boolean; onToggle: () => void }) {
  const t = r.ticket
  const valid = r.status === 'Paid' && t?.state === 'valid'
  const back = r.status === 'Refunded'
  const look = LOOKS[kindOf(r)]
  const [full, setFull] = useState<ReceiptData | null>(null)
  useEffect(() => {
    if (!open || back) return
    const get = () => api<ReceiptData>(`/api/receipts/${r.id}`).then(setFull).catch(() => {})
    get()
    const timer = setInterval(get, 5000) // the gate lets people in while it is on screen
    return () => clearInterval(timer)
  }, [open, back, r.id])
  const until = t?.valid_until_ms ? new Date(t.valid_until_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 rounded-3xl bg-card px-4 py-3.5 text-left transition-colors hover:bg-fill">
        <span aria-hidden className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${look.box}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={look.icon} /></svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{r.shop}</span>
          <span className="block truncate text-sm text-soft">
            {valid ? `Admits ${t!.admits - t!.admitted}${until ? `, until ${until} today` : ''}` : `${look.word}${r.paid_at_ms ? `, bought ${when(r.paid_at_ms)}` : ''}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-sm font-semibold">
          {open ? 'Hide' : valid ? 'Show' : 'View'}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
        </span>
      </button>
      <div className={`reveal ${open ? 'open' : ''}`}>
        <div>
          <div className="px-1 pb-2 pt-3">
            {back ? <Notice tone="good">{r.shop} refunded this ticket in full: {fmt(r.my_share ?? r.total)} went back to your balance. It no longer opens the gate.</Notice>
              : full ? <TicketPass r={full} /> : <div className="skeleton mx-auto h-96 w-full max-w-sm !rounded-[28px]" />}
          </div>
        </div>
      </div>
    </div>
  )
}

function ShopList({ shops, used, empty }: { shops: ShopRow[] | null; used: Map<string, { times: number }>; empty: string }) {
  if (shops === null) return <div className="space-y-3 p-5"><div className="skeleton h-11" /><div className="skeleton h-11" /></div>
  if (shops.length === 0) return <p className="p-5 text-sm text-soft">{empty}</p>
  return (
    <ul className="divide-y divide-line">
      {shops.map((s) => {
        const times = used.get(s.near_id)?.times
        const about = s.blurb || (s.kind === 'venue' ? (s.open ? 'Open, tickets at the gate' : 'Closed now') : s.kind === 'counter' ? s.place || 'Pay at the counter' : s.place)
        return (
          <li key={s.near_id}>
            <Link to={`/shop/${s.near_id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-canvas">
              <ShopIcon name={s.name} open={s.kind === 'venue' ? s.open : undefined} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold"><span className="truncate">{s.name}</span>{s.verified && <Tick />}</span>
                <span className="block truncate text-sm text-soft">{about}{times ? `${about ? ' · ' : ''}paid ${times === 1 ? 'once' : `${times} times`}` : ''}</span>
              </span>
              {!s.verified && <span className="text-xs font-medium text-bad">Not verified</span>}
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-line"><path d="m1.5 1.5 5 5.5-5 5.5" /></svg>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Lines that moved the balance: red for money out, green for money in. */
function Moves({ rows, empty, timeOnly }: { rows: Move[]; empty: string; timeOnly?: boolean }) {
  if (rows.length === 0) return <p className="p-5 text-sm text-soft">{empty}</p>
  return (
    <ul className="divide-y divide-line">
      {rows.map((m) => {
        const time = !m.at ? '' : timeOnly ? new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : when(m.at)
        const inner = (
          <>
            {m.shop ? <ShopIcon name={m.title} /> : (
              <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${m.amount < 0 ? 'bg-bad-wash text-bad' : 'bg-good-wash text-good'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={m.amount < 0 ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M5 12h14'} /></svg>
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.title}</span>
              <span className="block truncate text-xs text-soft">{m.note}{time ? `, ${time}` : ''}</span>
            </span>
            <span className={`num shrink-0 font-semibold ${m.amount < 0 ? 'text-bad' : 'text-good'}`}>{m.amount < 0 ? '−' : '+'}{fmt(Math.abs(m.amount))}</span>
          </>
        )
        return (
          <li key={m.key}>
            {m.to ? <Link to={m.to} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">{inner}</Link> : <div className="flex items-center gap-3 px-5 py-3.5">{inner}</div>}
          </li>
        )
      })}
    </ul>
  )
}

function Action({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="group flex flex-col items-center gap-1.5 rounded-2xl py-0.5 text-xs font-semibold disabled:opacity-50">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-fill group-hover:bg-line">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
      </span>
      {label}
    </button>
  )
}

function LimitsSheet({ limits, onClose, onSaved }: { limits: Limits; onClose: () => void; onSaved: () => void }) {
  const [perPayment, setPerPayment] = useState(String(toKes(limits.per_payment)))
  const [perDay, setPerDay] = useState(String(toKes(limits.per_day)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/wallet/limits', { body: { per_payment: kesToMicro(Number(perPayment)), per_day: kesToMicro(Number(perDay)) } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const field = 'num mt-1 w-full rounded-2xl bg-fill px-4 py-3 text-lg font-semibold outline-none focus:ring-2 focus:ring-iris'
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40" role="dialog" aria-label="Agent limits">
      <form onSubmit={save} className="sheet w-full max-w-md space-y-4 rounded-t-3xl bg-card p-6">
        <h2 className="text-2xl font-bold">What your agent may spend</h2>
        <p className="text-sm text-soft">Only you can change these. The NEAR contract refuses any payment by your agent that goes over. Your agent’s key can pay invoices; it can’t withdraw or raise its own limits.</p>
        <label className="block text-sm font-medium">Per payment, in shillings
          <input className={field} inputMode="numeric" value={perPayment} onChange={(e) => setPerPayment(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">Per day, in shillings
          <input className={field} inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="button" tone="quiet" onClick={onClose} className="flex-1">Cancel</Button>
          <Button disabled={busy || !(Number(perPayment) > 0) || !(Number(perDay) > 0)} className="flex-1">{busy ? 'Saving…' : 'Save limits'}</Button>
        </div>
      </form>
    </div>
  )
}
