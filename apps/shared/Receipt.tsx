import type { ReceiptData } from './api'
import { EXPLORER_TX, first, fmt, usd, when } from './ui'

const WHAT: Record<string, string> = { Single: 'Order', Group: 'Split bill', Ticket: 'Entry ticket' }

/** The paper slip every payment ends in. */
export function Receipt({ r, animate = false }: { r: ReceiptData; animate?: boolean }) {
  const listed = r.lines?.reduce((s, l) => s + l.qty * l.unit_price, 0) ?? r.total
  const discount = listed - r.total
  return (
    <div className={`slip-shadow mx-auto w-full max-w-sm ${animate ? 'print' : ''}`}>
      <article className="slip px-5 pt-6 text-sm">
        <header className="text-center">
          <p className="text-lg font-bold leading-tight">{r.shop}</p>
          <p className="text-xs text-soft">{r.shop_id}</p>
          <p className="mt-2 inline-block rounded-full bg-good-wash px-2.5 py-0.5 text-xs font-semibold text-good">
            {WHAT[r.kind] ?? r.kind} paid{r.kind === 'Ticket' ? (r.redeemed ? ', already used' : ', valid for one entry') : ''}
          </p>
        </header>

        {r.lines?.length ? (
          <ul className="cut mt-4 space-y-1.5 pt-3">
            {r.lines.map((l) => (
              <li key={l.sku} className="flex justify-between gap-3">
                <span>{l.qty} × {l.name}</span>
                <span className="num">{fmt(l.qty * l.unit_price)}</span>
              </li>
            ))}
            {discount > 0 && (
              <li className="flex justify-between gap-3 font-semibold text-good">
                <span>Agreed by your agent</span>
                <span className="num">−{fmt(discount)}</span>
              </li>
            )}
          </ul>
        ) : null}

        <div className="cut mt-3 flex items-baseline justify-between pt-3">
          <span className="font-semibold">Total paid</span>
          <span className="num text-3xl font-bold tracking-tight">{fmt(r.total)}</span>
        </div>
        <p className="num mt-0.5 text-right text-xs text-soft">Settled as {usd(r.total)} sUSD on NEAR</p>

        {r.payers.length > 1 && (
          <ul className="mt-2 space-y-1 text-xs">
            {r.payers.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{first(p.name)}’s agent</span>
                <span className="num">{fmt(p.amount)}</span>
              </li>
            ))}
            <li className="pt-1 text-soft">The shop was paid once, when the last share arrived.</li>
          </ul>
        )}

        <dl className="cut mt-3 space-y-1 pt-3 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-soft">Invoice</dt><dd className="num">{r.id}</dd></div>
          {r.payers.length === 1 && <div className="flex justify-between gap-3"><dt className="text-soft">Paid by</dt><dd>{r.payers[0].id}</dd></div>}
          {r.paid_at_ms ? <div className="flex justify-between gap-3"><dt className="text-soft">Settled</dt><dd>{when(r.paid_at_ms)}</dd></div> : null}
        </dl>
        {r.tx_hash && (
          <p className="mt-3 text-center text-xs">
            <a className="font-semibold text-iris underline-offset-2 hover:underline" href={EXPLORER_TX + r.tx_hash} target="_blank" rel="noreferrer">See the payment on NEAR</a>
          </p>
        )}
      </article>
    </div>
  )
}
