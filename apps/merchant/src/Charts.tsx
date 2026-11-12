import { useState } from 'react'

const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-US')}`
/** A round number at or above the largest value, so the top gridline is easy to read. */
function ceiling(max: number): number {
  if (max <= 0) return 100
  const step = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 5, 10].map((m) => m * step).find((v) => v >= max) ?? 10 * step
}

export type Day = { day: string; sales: number; refunds: number; count: number }

/** Sales for each of the last 14 days. Refunds hang below the line, so a day's net is visible at a glance. */
export function DaysChart({ days }: { days: Day[] }) {
  const [at, setAt] = useState<number | null>(null)
  const top = ceiling(Math.max(...days.map((d) => d.sales)))
  const low = Math.max(...days.map((d) => d.refunds))
  const W = 560, H = 190, left = 44, base = low > 0 ? 138 : 158, room = base - 14
  const slot = (W - left) / days.length
  const bar = Math.min(26, slot * 0.62)
  const shown = at ?? days.length - 1
  const d = days[shown]
  const label = (iso: string, long = false) => new Date(iso + 'T12:00:00').toLocaleDateString([], long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric' })
  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-soft">{label(d.day, true)}</span>
        <span className="num text-sm">
          <span className="font-semibold">{kes(d.sales)}</span> from {d.count} {d.count === 1 ? 'sale' : 'sales'}
          {d.refunds > 0 && <span className="text-bad">, {kes(d.refunds)} refunded</span>}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Sales for each of the last 14 days" onMouseLeave={() => setAt(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={base - room * f} y2={base - room * f} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={f === 0 ? undefined : '3 4'} />
            <text x={left - 8} y={base - room * f + 4} textAnchor="end" fontSize={10.5} fill="var(--color-soft)" className="num">{f === 0 ? '0' : (top * f).toLocaleString('en-US')}</text>
          </g>
        ))}
        {days.map((x, i) => {
          const cx = left + slot * i + slot / 2
          const h = (x.sales / top) * room
          const r = low > 0 ? (x.refunds / Math.max(low, top * 0.2)) * 22 : 0
          const on = i === shown
          return (
            <g key={x.day} onMouseEnter={() => setAt(i)} onFocus={() => setAt(i)} tabIndex={0} aria-label={`${label(x.day, true)}: ${kes(x.sales)}`} style={{ outline: 'none' }}>
              <rect x={left + slot * i} y={0} width={slot} height={H} fill="transparent" />
              {h > 0 ? <rect x={cx - bar / 2} y={base - h} width={bar} height={h} rx={Math.min(6, bar / 3)} fill={on ? 'var(--color-iris)' : 'var(--color-ink)'} opacity={on ? 1 : 0.86} />
                : <rect x={cx - bar / 2} y={base - 2} width={bar} height={2} rx={1} fill="var(--color-line)" />}
              {r > 0 && <rect x={cx - bar / 2} y={base + 3} width={bar} height={r} rx={3} fill="var(--color-bad)" opacity={0.75} />}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={10.5} fontWeight={on ? 700 : 400} fill={on ? 'var(--color-ink)' : 'var(--color-soft)'} className="num">{label(x.day)}</text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

/** Today by the hour: when the money comes in. Hours outside 05:00 to 23:00 are shown only if something sold. */
export function HoursChart({ hours }: { hours: number[] }) {
  const busy = hours.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0)
  const from = Math.min(6, ...busy), to = Math.max(21, ...busy)
  const shown = hours.slice(from, to + 1)
  const top = Math.max(1, ...shown)
  const peak = hours.indexOf(Math.max(...hours))
  return (
    <figure>
      <figcaption className="text-sm text-soft">
        {busy.length === 0 ? 'Nothing sold yet today.' : <>Busiest so far: <span className="font-semibold text-ink">{String(peak).padStart(2, '0')}:00 to {String(peak + 1).padStart(2, '0')}:00</span>, {kes(hours[peak])}</>}
      </figcaption>
      <div className="mt-3 flex h-24 items-end gap-[3px]" role="img" aria-label="Sales today for each hour">
        {shown.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${String(from + i).padStart(2, '0')}:00, ${kes(v)}`}>
            <div className={`w-full rounded-t-[4px] ${from + i === peak && v > 0 ? 'bg-iris' : v > 0 ? 'bg-ink' : 'bg-line'}`} style={{ height: v > 0 ? `${Math.max(8, (v / top) * 100)}%` : 2 }} />
          </div>
        ))}
      </div>
      <div className="num mt-1.5 flex justify-between text-[10.5px] text-soft"><span>{String(from).padStart(2, '0')}:00</span><span>{String(Math.round((from + to + 1) / 2)).padStart(2, '0')}:00</span><span>{String(to + 1).padStart(2, '0')}:00</span></div>
    </figure>
  )
}

/** What sells, by amount, over the last 14 days. */
export function TopItems({ items, unit }: { items: { name: string; qty: number; amount: number }[]; unit: string }) {
  if (items.length === 0) return <p className="text-sm text-soft">Nothing sold in the last 14 days.</p>
  const top = items[0].amount
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.name}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{i.name}</span>
            <span className="num shrink-0"><span className="font-semibold">{kes(i.amount)}</span> <span className="text-soft">from {i.qty} {i.qty === 1 ? unit.replace(/s$/, '') : unit}</span></span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-fill"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(3, (i.amount / top) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}
