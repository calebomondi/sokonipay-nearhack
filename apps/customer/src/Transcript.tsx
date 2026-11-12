import type { Ev, ReceiptData } from '@shared/api'
import { Receipt } from '@shared/Receipt'
import { TicketPass } from '@shared/TicketPass'
import { Notice, TxLink } from '@shared/ui'

/** The agents' conversation as it happens, ending in a receipt, a refusal or a split-bill link. */
export function Transcript({ events, running, shop }: { events: Ev[]; running: boolean; shop: { name: string; near_id: string } }) {
  return (
    <section aria-live="polite" className="space-y-3">
      {events.map((e, n) => {
        switch (e.t) {
          case 'status':
            return <p key={n} className={`rise text-center text-xs font-medium ${e.ok === false ? 'text-soft' : 'text-good'}`}>{e.text}</p>
          case 'msg': {
            const mine = e.from === 'personal'
            return (
              <div key={n} className={`rise flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <span className="mb-1 px-2 text-xs text-soft">{e.who}</span>
                <p className={`max-w-[85%] rounded-3xl px-4 py-2.5 ${mine ? 'rounded-br-md bg-iris text-white' : 'rounded-bl-md bg-card'}`}>{e.text}</p>
              </div>
            )
          }
          case 'tx':
            return <p key={n} className="rise text-center text-xs text-soft">{e.who}: {e.label}. <TxLink hash={e.hash} /></p>
          case 'refused':
            return (
              <div key={n} role="alert" className="rise rounded-3xl bg-bad-wash p-5">
                <p className="text-xl font-bold text-bad">The contract refused this payment</p>
                <p className="mt-1 text-sm">{e.text}</p>
                <p className="mt-2 text-sm text-soft">
                  {/insufficient/i.test(e.reason)
                    ? 'Your balance is too low for this. Add money from your home screen, then try again.'
                    : 'Your agent can’t go past the limits you set. Order less, or raise the limit from your home screen.'}{' '}
                  {e.hash && <TxLink hash={e.hash}>See the refused transaction</TxLink>}
                </p>
              </div>
            )
          case 'receipt': {
            const r: ReceiptData = { id: e.id, shop: shop.name, shop_id: shop.near_id, kind: e.kind, total: e.total, lines: e.lines, payers: e.payers, tx_hash: e.tx_hash, ticket: e.ticket }
            return <div key={n} className="pt-2">{e.kind === 'Ticket' ? <TicketPass r={r} animate /> : <Receipt r={r} animate />}</div>
          }
          case 'error':
            return <div key={n} className="rise"><Notice>{e.text}</Notice></div>
          default:
            return null
        }
      })}
      {running && <p className="dots py-1 text-center" aria-label="The agents are working"><i /><i /><i /></p>}
    </section>
  )
}
