import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, stream, type Ev, type Line, type Payer } from '@shared/api'
import { Button, Card, Notice, Spinner, first, fmt } from '@shared/ui'
import { Transcript } from './Transcript'

type Bill = {
  order_id: string; invoice_id: string; shop: string; organiser: string; total: number; party_size: number
  lines: Line[] | null; status: string; funded: number; share: number; paid: Payer[]
}

/** A friend opens a split-bill link and lets their agent pay their share. */
export default function Join() {
  const { orderId = '' } = useParams()
  const [bill, setBill] = useState<Bill | null>(null)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<Ev[]>([])
  const [running, setRunning] = useState(false)
  const busy = useRef(false)

  const load = useCallback(() => api<Bill>(`/api/orders/${orderId}`).then(setBill).catch((e) => setError(e.message)), [orderId])
  useEffect(() => {
    load()
  }, [load])

  async function pay() {
    if (busy.current) return // a second tap before the button disables
    busy.current = true
    setRunning(true)
    setEvents([])
    try {
      await stream<Ev>(`/api/orders/${orderId}/join`, {}, (e) => setEvents((all) => [...all, e]))
    } catch (e) {
      setEvents((all) => [...all, { t: 'error', text: (e as Error).message }])
    } finally {
      busy.current = false
      setRunning(false)
      load()
    }
  }

  if (error) return <div className="mx-auto max-w-md space-y-3 p-5"><Notice>{error}</Notice><Link to="/" className="font-medium text-iris">Go to your account</Link></div>
  if (!bill) return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>
  const settled = events.some((e) => e.t === 'receipt')
  const open = bill.status === 'collecting' && !settled

  return (
    <main className="mx-auto flex panel w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5">
      <Link to="/" className="w-fit rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">Your account</Link>
      <header>
        <p className="text-sm text-soft">{first(bill.organiser)} is splitting a bill at</p>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight">{bill.shop}</h1>
      </header>

      <Card>
        {bill.lines && (
          <ul className="space-y-1.5 text-sm">
            {bill.lines.map((l) => (
              <li key={l.sku} className="flex justify-between gap-3"><span>{l.qty} × {l.name}</span><span className="num text-soft">{fmt(l.qty * l.unit_price)}</span></li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm text-soft">Total between {bill.party_size}</span>
          <span className="num text-xl font-bold">{fmt(bill.total)}</span>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {bill.paid.map((p) => (
            <li key={p.id} className="flex justify-between gap-3"><span>{first(p.name)} paid</span><span className="num">{fmt(p.amount)}</span></li>
          ))}
          {open && <li className="text-soft">{bill.party_size - bill.paid.length} still to pay</li>}
        </ul>
      </Card>

      {events.length > 0 && <Transcript events={events} running={running} shop={{ name: bill.shop, near_id: '' }} />}

      {open && !running && !events.some((e) => e.t === 'receipt' || e.t === 'tx') && (
        <Card className="space-y-3 text-center">
          <p className="text-sm text-soft">Your share</p>
          <p className="num text-5xl font-extrabold tracking-tight">{fmt(bill.share)}</p>
          <Button onClick={pay} className="w-full">Pay my share</Button>
          <p className="text-xs text-soft">Your agent pays into escrow. The shop is paid when the last share arrives. If it never does, you’re refunded.</p>
        </Card>
      )}
      {!open && events.length === 0 && (
        <Notice tone={bill.status === 'paid' ? 'good' : 'plain'}>
          {bill.status === 'paid' ? 'This bill is settled. ' : 'This bill is no longer open. '}
          {bill.status === 'paid' && <Link to={`/r/${bill.invoice_id}`} className="font-semibold underline">Open the receipt</Link>}
        </Notice>
      )}
    </main>
  )
}
