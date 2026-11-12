import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useState } from 'react'
import type { ReceiptData, Ticket } from './api'
import { EXPLORER_TX, fmt, usd } from './ui'

/** A small seeded random source, so each ticket number always draws the same picture. */
function seeded(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/** Tree rings unique to this ticket: wobbly concentric growth rings, a few knots, drawn from its number. */
function Rings({ id, ink }: { id: string; ink: string }) {
  const rings = useMemo(() => {
    const rnd = seeded(id)
    const cx = 100 + (rnd() - 0.5) * 30
    const cy = 100 + (rnd() - 0.5) * 30
    const count = 9 + Math.floor(rnd() * 5)
    const phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]
    const out: { d: string; w: number; o: number }[] = []
    for (let r = 0; r < count; r++) {
      const radius = 10 + r * (118 / count) + rnd() * 4
      const wobble = 1.5 + rnd() * (2 + r * 0.6)
      const pts: string[] = []
      for (let a = 0; a <= 72; a++) {
        const t = (a / 72) * Math.PI * 2
        const rr = radius + Math.sin(t * 3 + phase[0]) * wobble + Math.sin(t * 5 + phase[1] + r) * wobble * 0.5 + Math.sin(t * 2 + phase[2]) * wobble * 0.8
        pts.push(`${(cx + Math.cos(t) * rr).toFixed(1)},${(cy + Math.sin(t) * rr).toFixed(1)}`)
      }
      out.push({ d: `M${pts.join('L')}Z`, w: 0.8 + rnd() * 2.2, o: 0.25 + rnd() * 0.55 })
    }
    return out
  }, [id])
  return (
    <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g className="turn" fill="none" stroke={ink}>
        {rings.map((r, n) => <path key={n} d={r.d} strokeWidth={r.w} opacity={r.o} />)}
      </g>
    </svg>
  )
}

const LOOK = {
  valid: { bg: '#0b8f61', ink: '#d6f5e6', label: 'Valid today' },
  expired: { bg: '#c2570c', ink: '#fde3c8', label: 'Expired' },
  used: { bg: '#5b6170', ink: '#d9dce3', label: 'Used' },
} as const

function stateOf(t: Ticket, now: number): keyof typeof LOOK {
  if (t.admitted >= t.admits) return 'used'
  if (t.valid_until_ms && now > t.valid_until_ms) return 'expired'
  return 'valid'
}

/**
 * The pass a person shows at the gate. Green while it works, orange once the venue has closed,
 * grey when everyone on it is in. The clock ticks and a band of light crosses it, so a
 * screenshot is easy to spot. The picture is drawn from the ticket number, so no two match.
 */
export function TicketPass({ r, animate = false }: { r: ReceiptData; animate?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const t = r.ticket ?? { admits: 1, admitted: r.redeemed ? 1 : 0, valid_until_ms: 0 }
  const state = stateOf(t, now)
  const look = LOOK[state]
  const left = t.admits - t.admitted
  const closes = t.valid_until_ms ? new Date(t.valid_until_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <article className={`mx-auto w-full max-w-sm overflow-hidden rounded-[28px] bg-card shadow-[0_10px_30px_rgb(12_14_18/0.10)] ${animate ? 'rise' : ''}`} aria-label={`Ticket for ${r.shop}: ${look.label}`}>
      <div className="relative h-56 overflow-hidden text-white transition-colors duration-700" style={{ background: look.bg }}>
        <Rings id={r.id} ink={look.ink} />
        {state === 'valid' && <div className="sweep pointer-events-none absolute inset-y-0 w-1/3 bg-white/20" aria-hidden />}
        <div className="absolute inset-0 flex flex-col justify-between p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-lg font-bold leading-tight drop-shadow-sm">{r.shop}</p>
            <p className="num rounded-full bg-black/25 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm">#{r.id.replace(/^tkt-/, '').slice(0, 6).toUpperCase()}</p>
          </div>
          <div>
            <p className="text-4xl font-extrabold leading-none tracking-tight drop-shadow-sm">{look.label}</p>
            <p className="num mt-1.5 text-sm font-medium opacity-95">
              {state === 'valid'
                ? `${closes ? `Valid until ${closes} · ` : ''}Now ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : state === 'expired' && closes ? `Closed at ${closes}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex items-center gap-4 px-5 py-5">
        {/* the notches where a paper ticket would tear */}
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-canvas" aria-hidden />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-canvas" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-soft">{state === 'used' ? 'Everyone on this ticket is in' : state === 'expired' ? 'This ticket was for' : 'Admits'}</p>
          <p className="text-3xl font-extrabold tracking-tight">
            {state === 'valid' ? left : t.admits} <span className="text-base font-semibold text-soft">{(state === 'valid' ? left : t.admits) === 1 ? 'person' : 'people'}</span>
          </p>
          {state === 'valid' && t.admitted > 0 && <p className="text-xs text-soft">{t.admitted} of {t.admits} already in</p>}
          {r.lines && <p className="mt-1.5 text-sm">{r.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</p>}
          <p className="num mt-1 text-sm text-soft">Paid {fmt(r.total)} <span className="text-xs">({usd(r.total)} sUSD)</span></p>
        </div>
        <div className={`shrink-0 rounded-2xl border border-line p-2 ${state === 'valid' ? '' : 'opacity-30'}`}>
          <QRCodeSVG value={r.id} size={104} fgColor="#0c0e12" bgColor="#ffffff" level="M" />
        </div>
      </div>

      <div className="border-t border-dashed border-line px-5 py-3 text-xs text-soft">
        <p>
          {state === 'valid' ? `Show this at the gate. It stops working ${closes ? `at ${closes}` : 'when the venue closes'} today.`
            : state === 'expired' ? 'The venue has closed for the day, so this ticket no longer opens the gate.'
            : 'This ticket has been used and can’t be used again.'}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="num">{r.id}</span>
          {r.tx_hash && <a className="font-semibold text-iris hover:underline" href={EXPLORER_TX + r.tx_hash} target="_blank" rel="noreferrer">See the payment on NEAR</a>}
        </p>
      </div>
    </article>
  )
}
