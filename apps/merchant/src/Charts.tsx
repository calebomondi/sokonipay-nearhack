import { useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type Day = { day: string; sales: number; refunds: number; count: number; refunded: number; refused: number; customers: number }
export type Item = { name: string; qty: number; amount: number }

const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-US')}`
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 || n % 1000 === 0 ? 0 : 1)}k` : String(Math.round(n)))
const INK = 'var(--color-ink)', BLUE = 'var(--color-iris)', SOFT = 'var(--color-soft)', LINE = 'var(--color-line)'
const tick = { fontSize: 11, fill: SOFT, fontFamily: 'var(--font-sans)' }
const date = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00').toLocaleDateString([], opts)

/** The box that follows the pointer on a chart. */
function Tip({ title, rows }: { title: string; rows: [string, string, string?][] }) {
  return (
    <div className="rounded-2xl bg-ink px-3.5 py-2.5 text-xs text-white shadow-[0_10px_30px_rgb(12_14_18/0.25)]">
      <p className="font-semibold">{title}</p>
      <dl className="mt-1.5 space-y-1">
        {rows.map(([k, v, tone]) => (
          <div key={k} className="flex justify-between gap-5"><dt className="text-white/65">{k}</dt><dd className={`num font-semibold ${tone ?? ''}`}>{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}

/** A choice between a few options, as a small pill. */
export function Segmented<T extends string | number>({ value, options, onPick, label }: { value: T; options: [T, string][]; onPick: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-fill p-0.5 text-xs font-semibold">
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onPick(v)} className={`rounded-full px-3 py-1.5 transition-colors ${value === v ? 'bg-card text-ink shadow-sm' : 'text-soft hover:text-ink'}`}>{text}</button>
      ))}
    </div>
  )
}

/** Sales per day over the chosen period, with the period's average as a dashed line. Today is the blue bar. */
export function SalesChart({ days }: { days: Day[] }) {
  const [span, setSpan] = useState<7 | 14 | 30>(14)
  const shown = days.slice(-span)
  const total = shown.reduce((n, d) => n + d.sales, 0)
  const refunds = shown.reduce((n, d) => n + d.refunds, 0)
  const count = shown.reduce((n, d) => n + d.count, 0)
  const avg = total / shown.length
  const best = shown.reduce((a, b) => (b.sales > a.sales ? b : a))
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Sales</h2>
          <p className="num mt-1 text-3xl font-extrabold tracking-tight">{kes(total - refunds)}</p>
          <p className="mt-0.5 text-sm text-soft">
            net from {count} {count === 1 ? 'sale' : 'sales'} in {span} days{refunds > 0 && <>, after <span className="text-bad">{kes(refunds)}</span> refunded</>}
          </p>
        </div>
        <Segmented label="Period" value={span} onPick={setSpan} options={[[7, '7 days'], [14, '14 days'], [30, '30 days']]} />
      </div>
      <div className="mt-4 h-56" role="img" aria-label={`Sales for each of the last ${span} days. Best day: ${date(best.day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${kes(best.sales)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={span === 30 ? '18%' : '28%'}>
            <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="3 5" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={tick} interval={span === 30 ? 4 : span === 14 ? 1 : 0}
              tickFormatter={(d: string) => date(d, span === 7 ? { weekday: 'short' } : { day: 'numeric', month: span === 30 ? 'short' : undefined })} />
            <YAxis tickLine={false} axisLine={false} tick={tick} tickFormatter={short} width={44} />
            <Tooltip cursor={{ fill: 'var(--color-fill)', radius: 8 }} isAnimationActive={false}
              content={({ active, payload }) => {
                const d = active && payload?.[0] ? (payload[0].payload as Day) : null
                return d ? <Tip title={date(d.day, { weekday: 'long', day: 'numeric', month: 'short' })} rows={[
                  ['Sales', kes(d.sales)], ['Number of sales', String(d.count)],
                  ...(d.refunds ? [['Refunded', `−${kes(d.refunds)}`, 'text-[#ff9aa2]'] as [string, string, string]] : []),
                  ['Net', kes(d.sales - d.refunds)], ['Customers', String(d.customers)],
                ]} /> : null
              }} />
            {avg > 0 && <ReferenceLine y={avg} stroke={SOFT} strokeDasharray="5 5" label={{ value: `average ${short(avg)}`, position: 'insideTopLeft', fontSize: 11, fill: SOFT }} />}
            <Bar dataKey="sales" radius={[6, 6, 2, 2]} maxBarSize={34} isAnimationActive={false}>
              {shown.map((d, i) => <Cell key={d.day} fill={i === shown.length - 1 ? BLUE : INK} fillOpacity={i === shown.length - 1 ? 1 : 0.88} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** Today's money by the hour as a filled curve, against the dotted average of the last two weeks at each hour. */
export function HoursChart({ hours, usual, nowHour }: { hours: number[]; usual: number[]; nowHour?: number }) {
  const busy = hours.map((v, h) => (v > 0 || usual[h] > 0 ? h : -1)).filter((h) => h >= 0)
  const from = Math.min(6, ...busy), to = Math.max(21, ...busy)
  const now = nowHour ?? new Date().getHours() // the shop's clock, from the server, not this computer's
  const data = hours.slice(from, to + 1).map((v, i) => ({ hour: from + i, today: from + i <= now ? v : null, usual: usual[from + i] }))
  const so_far = hours.reduce((a, b) => a + b, 0)
  const typical = usual.slice(0, now + 1).reduce((a, b) => a + b, 0)
  const diff = typical > 0 ? Math.round(((so_far - typical) / typical) * 100) : null
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  return (
    <div>
      <h2 className="text-xl font-bold">Today against a usual day</h2>
      <p className="mt-1 text-sm text-soft">
        {so_far === 0 ? 'Nothing sold yet today.' : diff === null ? <><span className="font-semibold text-ink">{kes(so_far)}</span> so far. No earlier days to compare with yet.</>
          : <><span className="font-semibold text-ink">{kes(so_far)}</span> so far, <span className={`font-semibold ${diff >= 0 ? 'text-good' : 'text-bad'}`}>{Math.abs(diff)}% {diff >= 0 ? 'above' : 'below'}</span> a usual day by this hour.</>}
      </p>
      <div className="mt-3 h-36" role="img" aria-label="Sales today for each hour, with the two-week average for comparison">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="today-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0000ff" stopOpacity={0.28} /><stop offset="100%" stopColor="#0000ff" stopOpacity={0.02} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="3 5" />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={tick} tickFormatter={hh} interval={3} />
            <YAxis tickLine={false} axisLine={false} tick={tick} tickFormatter={short} width={44} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: SOFT, strokeDasharray: '3 4' }}
              content={({ active, payload }) => {
                const d = active && payload?.[0] ? (payload[0].payload as { hour: number; today: number | null; usual: number }) : null
                return d ? <Tip title={`${hh(d.hour)} to ${hh(d.hour + 1)}`} rows={[['Today', d.today === null ? 'not yet' : kes(d.today)], ['Usual', kes(d.usual)]]} /> : null
              }} />
            <Line type="monotone" dataKey="usual" stroke={SOFT} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="today" stroke={BLUE} strokeWidth={2.2} fill="url(#today-fill)" dot={false} connectNulls={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 flex gap-4 text-xs text-soft">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-iris" />Today</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-soft" />A usual day: the average of days with sales in the last 14</span>
      </p>
    </div>
  )
}

const SHADES = ['#0c0e12', '#0000ff', '#5b6b8c', '#9aa1ad', '#c9ced8', '#e2e5eb']

/** What sells: one bar divided by each item's share of the money, then the list. */
export function Mix({ items, unit }: { items: Item[]; unit: string }) {
  const total = items.reduce((n, i) => n + i.amount, 0)
  return (
    <div>
      <h2 className="text-xl font-bold">What sells</h2>
      {total === 0 ? <p className="mt-2 text-sm text-soft">Nothing sold in the last 14 days.</p> : (
        <>
          <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Each item's share of sales">
            {items.map((i, n) => <span key={i.name} style={{ width: `${(i.amount / total) * 100}%`, background: SHADES[n % SHADES.length] }} title={`${i.name}: ${Math.round((i.amount / total) * 100)}%`} />)}
          </div>
          <ul className="mt-3 divide-y divide-line text-sm">
            {items.map((i, n) => (
              <li key={i.name} className="flex items-center gap-3 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SHADES[n % SHADES.length] }} />
                <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                <span className="num text-soft">{i.qty} {i.qty === 1 ? unit.replace(/s$/, '') : unit}</span>
                <span className="num w-24 text-right font-semibold">{kes(i.amount)}</span>
                <span className="num w-10 text-right text-soft">{Math.round((i.amount / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** How payments ended over the last 14 days. A refusal is a customer who tried to pay and couldn't. */
export function Outcomes({ days }: { days: Day[] }) {
  const recent = days.slice(-14)
  const paid = recent.reduce((n, d) => n + d.count - d.refunded, 0)
  const refunded = recent.reduce((n, d) => n + d.refunded, 0)
  const refused = recent.reduce((n, d) => n + d.refused, 0)
  const total = Math.max(1, paid + refunded + refused)
  const parts: [string, number, string, string][] = [
    ['Paid', Math.max(0, paid), 'bg-good', 'Settled and kept'],
    ['Refunded', refunded, 'bg-amber', 'You gave the money back'],
    ['Refused', refused, 'bg-bad', 'Over a customer’s limit or balance'],
  ]
  return (
    <div>
      <h2 className="text-xl font-bold">How payments ended</h2>
      <p className="mt-1 text-sm text-soft">The last 14 days.</p>
      <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-fill" role="img" aria-label={`${paid} paid, ${refunded} refunded, ${refused} refused`}>
        {parts.map(([k, v, cls]) => v > 0 && <span key={k} className={cls} style={{ width: `${(v / total) * 100}%` }} />)}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {parts.map(([k, v, cls, note]) => (
          <div key={k}>
            <dt className="flex items-center gap-1.5 text-xs text-soft"><span className={`h-2 w-2 rounded-full ${cls}`} />{k}</dt>
            <dd className="num mt-0.5 text-2xl font-extrabold tracking-tight">{v}</dd>
            <p className="text-xs text-soft">{note}</p>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** A small trend line with no axes, for a metric card. */
export function Spark({ values, tone = 'ink' }: { values: number[]; tone?: 'ink' | 'white' | 'blue' }) {
  const max = Math.max(1, ...values)
  const W = 120, H = 34
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, H - 3 - (v / max) * (H - 8)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const stroke = tone === 'white' ? '#fff' : tone === 'blue' ? '#0000ff' : '#0c0e12'
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={stroke} opacity={0.08} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.9} />
      <circle cx={lx} cy={ly} r={2.6} fill={stroke} />
    </svg>
  )
}

/** One figure the owner watches: its value, how it compares with yesterday, and its recent shape. */
export function Metric({ label, value, note, change, trend, dark, children }: {
  label: string; value: ReactNode; note?: ReactNode
  /** Against yesterday: a percentage or a plain difference, already worded ("12%", "3"). Positive is good. */
  change?: { up: boolean; text: string } | null
  trend?: number[]; dark?: boolean; children?: ReactNode
}) {
  return (
    <section className={`flex flex-col rounded-3xl p-5 ${dark ? 'bg-ink text-white' : 'bg-card'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm ${dark ? 'text-white/70' : 'text-soft'}`}>{label}</p>
        {change && (
          <span className={`num flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${change.up ? 'bg-good-wash text-good' : 'bg-bad-wash text-bad'}`}>
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className={change.up ? '' : 'rotate-180'}><path d="M5 1.5 9 8H1z" fill="currentColor" /></svg>{change.text}
          </span>
        )}
      </div>
      <p className="num mt-1.5 text-[2rem] font-extrabold leading-none tracking-tight">{value}</p>
      {note && <p className={`mt-1.5 text-xs ${dark ? 'text-white/60' : 'text-soft'}`}>{note}</p>}
      {trend && <div className="mt-auto pt-3"><Spark values={trend} tone={dark ? 'white' : 'ink'} /></div>}
      {children}
    </section>
  )
}
