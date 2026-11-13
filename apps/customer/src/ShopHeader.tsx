import { useEffect, useState } from 'react'
import { api } from '@shared/api'
import { Notice, ShopIcon, Tick } from '@shared/ui'
import type { Shop } from './ShopPage'

const KIND: Record<string, string> = { venue: 'Park or venue', food: 'Food and drink', counter: 'Pay at the counter' }
const ICONS = {
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5v4.8l3 1.8',
  shield: 'M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6zM9 12l2.2 2.2L15.2 10',
  again: 'M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9M17.9 3.6v3.6h-3.6M6.1 20.4v-3.6h3.6',
  tag: 'M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7zM7.8 8.8h.01',
}

function Fact({ icon, children, quiet }: { icon: keyof typeof ICONS; children: React.ReactNode; quiet?: boolean }) {
  return (
    <li className={`flex items-start gap-3 ${quiet ? 'text-soft' : ''}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0 text-soft"><path d={ICONS[icon]} /></svg>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

/** Who the shop is, before what it sells: its name and checkmark, what it says about itself, where and when. */
export function ShopHeader({ shop }: { shop: Shop }) {
  const [times, setTimes] = useState(0)
  useEffect(() => {
    api<{ times: number }>(`/api/shops/${shop.near_id}/visits`).then((r) => setTimes(r.times)).catch(() => {})
  }, [shop.near_id])
  const closed = shop.hours_line.startsWith('Closed')
  return (
    <header className="rounded-3xl bg-card p-5">
      <div className="flex items-center gap-4">
        <span className="scale-125 pl-1"><ShopIcon name={shop.name} /></span>
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-extrabold leading-tight tracking-tight">{shop.name.split(' ').slice(0, -1).join(' ')} <span className="whitespace-nowrap">{shop.name.split(' ').slice(-1)}{shop.verified && <>{'\u00A0'}<Tick size={20} /></>}</span></h1>
          <p className="text-sm text-soft">{KIND[shop.kind] ?? 'Shop'}</p>
        </div>
      </div>
      {shop.blurb && <p className="mt-4 leading-relaxed">{shop.blurb}</p>}
      <ul className="mt-4 space-y-2.5 text-sm">
        {shop.place && <Fact icon="pin">{shop.place}</Fact>}
        {shop.hours_line && <Fact icon="clock"><span className={closed ? 'text-soft' : 'font-medium text-good'}>{shop.hours_line.split(' · ')[0]}</span>{shop.hours_line.includes(' · ') && <span className="text-soft"> · {shop.hours_line.split(' · ')[1]}</span>}</Fact>}
        {shop.verified && <Fact icon="shield" quiet>Verified shop<span className="block truncate text-xs" title={shop.near_id}>{shop.near_id}</span></Fact>}
        {shop.discounts_for.length > 0 && <Fact icon="tag">Offers a discount for {shop.discounts_for.slice(0, 2).join(', or ')}. Your agent asks.</Fact>}
        {times > 0 && <Fact icon="again" quiet>You’ve paid here {times === 1 ? 'once' : `${times} times`}</Fact>}
      </ul>
      {!shop.verified && <div className="mt-4"><Notice>{shop.near_id} is not a verified shop. Your agent won’t pay it.</Notice></div>}
    </header>
  )
}
