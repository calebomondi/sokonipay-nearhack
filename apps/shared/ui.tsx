import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const MICRO = 1_000_000
// People read shillings; the contract settles in dollars (sUSD). One rate, read from the API before the app
// draws, converts between them. Amounts from the API are always micro sUSD.
let kesPerUsd = 129
export async function loadRate(api: string): Promise<void> {
  try {
    const rate = Number((await (await fetch(api + '/api/health')).json()).kes_per_usd)
    if (rate > 0) kesPerUsd = rate
  } catch {
    /* keep the built-in rate; amounts are still close */
  }
}
/** Dollars with two decimals, for the few places that show the settlement amount: 9.80 */
export const usd = (micro: number) => (micro / MICRO).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** An amount as people read it: KES 1,274 */
export const fmt = (micro: number) => `KES ${Math.round((micro / MICRO) * kesPerUsd).toLocaleString('en-US')}`
export const toKes = (micro: number) => Math.round((micro / MICRO) * kesPerUsd)
export const kesToMicro = (kes: number) => Math.round((kes / kesPerUsd) * MICRO)
export const toMicro = (dollars: number) => Math.round(dollars * MICRO)
export const first = (name: string) => name.split(' ')[0]
/** The API's text timestamps are UTC with no zone marker; say so, or the browser reads them as local time. */
export const when = (ms: number | string) =>
  new Date(typeof ms === 'string' && !/(Z|[+-]\d\d:?\d\d)$/.test(ms) ? ms + 'Z' : ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const EXPLORER_TX = 'https://testnet.nearblocks.io/txns/'
export const EXPLORER_ACCOUNT = 'https://testnet.nearblocks.io/address/'

/** Shillings, with "KES" set small. `dollars` adds the settlement amount underneath. */
export function Money({ micro, className = '', dollars = false }: { micro: number; className?: string; dollars?: boolean }) {
  return (
    <span className={`num ${className}`}>
      <span className="mr-1 text-[0.5em] font-semibold text-soft">KES</span>
      {toKes(micro).toLocaleString('en-US')}
      {dollars && <span className="mt-1.5 block text-xs font-medium tracking-normal text-soft">{usd(micro)} sUSD on NEAR</span>}
    </span>
  )
}

export function Button({
  tone = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'quiet' | 'dark' }) {
  const tones = {
    primary: 'bg-iris text-white hover:bg-iris-deep',
    dark: 'bg-ink text-white hover:bg-black',
    quiet: 'bg-fill text-ink hover:bg-line',
  }
  return <button {...props} className={`rounded-full px-5 py-3 font-semibold transition-colors disabled:opacity-40 ${tones[tone]} ${className}`} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-card p-5 ${className}`}>{children}</section>
}

export function Spinner() {
  return <span role="status" aria-label="Loading" className="spin inline-block h-6 w-6 rounded-full border-[3px] border-line border-t-iris" />
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  return (
    <a href={EXPLORER_TX + hash} target="_blank" rel="noreferrer" className="font-medium text-iris underline-offset-2 hover:underline">
      {children ?? 'View on NEAR'}
    </a>
  )
}

/** The blue checkmark of a shop on the onchain register. */
export function Tick({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role="img" aria-label="Verified" className="inline-block shrink-0 align-[-0.15em]">
      <title>Verified on NEAR</title>
      <path fill="var(--color-tick)" d="M10 1.2 12.3 3l2.9-.2.9 2.7 2.4 1.6-.9 2.9.9 2.9-2.4 1.6-.9 2.7-2.9-.2L10 18.8 7.7 17l-2.9.2-.9-2.7-2.4-1.6.9-2.9-.9-2.9 2.4-1.6.9-2.7 2.9.2z" />
      <path d="m6.6 10.2 2.3 2.3 4.5-4.8" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** On a shop's own page: the checkmark with the account it belongs to, so a fake sticker shows. */
export function VerifiedLine({ id }: { id: string }) {
  return <p className="flex flex-wrap items-center gap-1.5 text-sm text-soft"><Tick /> Verified shop <span aria-hidden>·</span> <span className="break-all">{id}</span></p>
}

const TINTS = ['#e8ecff', '#e3f4ec', '#fdefe0', '#fbe7ef', '#e6f3fa', '#f0eafc', '#f4f0dc']
const INKS = ['#2a37b8', '#0b6b49', '#9a4a0b', '#a52457', '#0f5f86', '#5a36a8', '#6b5d10']

/** A shop's picture: a soft square with its initials, tinted from its name so each shop keeps one colour. */
/** A shop's own colour pair and initials, the same wherever the shop appears. */
export function shopLook(name: string): { tint: string; ink: string; initials: string } {
  const n = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length
  return { tint: TINTS[n], ink: INKS[n], initials: name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') }
}

/** The SokoniPay mark. `children` sits beside it, for "for shops". */
export function Logo({ size = 32, children }: { size?: number; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* The file has a white ground; multiply lets the page colour show through it. */}
      <img src="/sokonipay-logo.png" alt="SokoniPay" width={size} height={size} className="shrink-0 mix-blend-multiply" />
      {children}
    </span>
  )
}

export function ShopIcon({ name, open }: { name: string; open?: boolean }) {
  const { tint, ink, initials } = shopLook(name)
  return (
    <span aria-hidden className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-sm font-bold" style={{ background: tint, color: ink }}>
      {initials}
      {open !== undefined && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${open ? 'bg-good' : 'bg-soft'}`} />}
    </span>
  )
}

/** A round badge with initials, like a contact picture. For people. */
export function Badge({ name, tone = 'fill' }: { name: string; tone?: 'fill' | 'iris' }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
  return (
    <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${tone === 'iris' ? 'bg-iris text-white' : 'bg-fill text-ink'}`}>
      {initials}
    </span>
  )
}

/** How much of a limit has been used. */
export function Meter({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="h-full rounded-full bg-iris" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Notice({ tone = 'bad', children }: { tone?: 'bad' | 'good' | 'plain'; children: ReactNode }) {
  const tones = { bad: 'bg-bad-wash text-bad', good: 'bg-good-wash text-good', plain: 'bg-fill text-ink' }
  return <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-2xl px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>
}
