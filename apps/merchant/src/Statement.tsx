import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@shared/api'
import { Button, Card, Notice, Spinner, usd } from '@shared/ui'

type Share = { account_id: string; amount: number }
type Row = {
  id: string; at: string; customer: string; kind: string; what: string; people: number; admitted: number
  total: number; total_kes: number; kept: number; shares: Share[]; refunded: boolean
}
type Data = {
  day: string; shop: string; kind: 'venue' | 'food'; rows: Row[]
  refunds: { id: string; at: string; customer: string; total: number; total_kes: number }[]
  totals: {
    sales: number; sales_kes: number; count: number; refunds: number; refunds_kes: number; refund_count: number
    net: number; net_kes: number; people: number; admitted: number; shared: Share[]; kept: number; kept_net?: number; refused: number
  }
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
const kes = (n: number) => n.toLocaleString('en-US')
const label = (account: string) => account.split('.')[0].replace(/^./, (c) => c.toUpperCase())

/** One day's books: what was sold, given back and shared out. Made to print and to hand to an accountant. */
export default function Statement() {
  const [day, setDay] = useState(today)
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setD(null)
    setError('')
    api<Data>(`/api/console/statement?day=${day}`).then(setD).catch((e) => setError(e.message))
  }, [day])

  const download = () => {
    if (!d) return
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [
      ['Time', 'Type', 'Reference', 'Customer', 'Items', 'People', 'Admitted', 'Amount KES', 'Amount sUSD', 'Kept sUSD', 'Shared sUSD', 'Status'],
      ...d.rows.map((r) => [clock(r.at), r.kind === 'Ticket' ? 'Ticket' : 'Order', r.id, r.customer, r.what, r.people, r.admitted, r.total_kes,
        usd(r.total), usd(r.kept), usd(r.total - r.kept), r.refunded ? 'Refunded' : 'Paid']),
      ...d.refunds.map((r) => [clock(r.at), 'Refund', r.id, r.customer, '', '', '', -r.total_kes, `-${usd(r.total)}`, '', '', 'Refund']),
    ]
    const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(',')).join('\n')], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `sokonipay-${d.day}.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const t = d?.totals
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-5 pb-12 pt-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/" className="text-sm font-medium text-soft hover:text-ink print:hidden">← Back to the console</Link>
          <h1 className="mt-1 text-4xl font-extrabold leading-tight tracking-tight">Daily statement</h1>
          <p className="mt-1 text-sm text-soft">{d ? `${d.shop}, ` : ''}{new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, Nairobi time</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <input type="date" aria-label="Day" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} className="rounded-full bg-card px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-iris" />
          <Button tone="quiet" disabled={!d} onClick={() => window.print()} className="!py-2.5 text-sm">Print</Button>
          <Button disabled={!d || (d.rows.length === 0 && d.refunds.length === 0)} onClick={download} className="!py-2.5 text-sm">Download CSV</Button>
        </div>
      </header>

      {error && <Notice>{error}</Notice>}
      {!d && !error && <div className="flex justify-center py-16"><Spinner /></div>}

      {d && t && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure name="Sales" kes={t.sales_kes} micro={t.sales} note={`${t.count} ${t.count === 1 ? 'sale' : 'sales'}${t.refused ? `, ${t.refused} refused by the contract` : ''}`} />
            <Figure name="Refunds" kes={-t.refunds_kes} micro={-t.refunds} note={`${t.refund_count} given back`} />
            <Figure name="Net for the day" kes={t.net_kes} micro={t.net} note="Sales less refunds" strong />
            {d.kind === 'venue'
              ? <Card><p className="text-sm text-soft">People</p><p className="num mt-1 text-3xl font-extrabold tracking-tight">{t.admitted} <span className="text-base font-semibold text-soft">of {t.people} in</span></p><p className="mt-2 text-xs text-soft">Admitted at the gate, of those who bought</p></Card>
              : <Card><p className="text-sm text-soft">Kept by the shop</p><p className="num mt-1 text-3xl font-extrabold tracking-tight">{usd(t.kept_net ?? t.kept)}</p><p className="mt-2 text-xs text-soft">sUSD, after the split and refunds</p></Card>}
          </div>

          <Card>
            <h2 className="font-semibold">Where the sales went</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt>Shop balance</dt><dd className="num font-semibold">{usd(t.kept)} sUSD</dd></div>
              {t.shared.map((s) => (
                <div key={s.account_id} className="flex justify-between gap-3"><dt>{label(s.account_id)} <span className="text-soft">({s.account_id})</span></dt><dd className="num font-semibold">{usd(s.amount)} sUSD</dd></div>
              ))}
              <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="text-soft">Total, as divided by the contract when each sale settled</dt><dd className="num">{usd(t.sales)} sUSD</dd></div>
            </dl>
            <p className="mt-3 text-xs text-soft">Refunds are paid in full from the shop balance. Shilling amounts use the rate at the time of each sale.</p>
          </Card>

          <Card className="!p-0">
            {d.rows.length === 0 && d.refunds.length === 0 ? (
              <p className="p-5 text-sm text-soft">Nothing was sold or refunded on this day.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-soft">
                    <tr>
                      <th className="px-5 py-3 font-medium">Time</th><th className="py-3 font-medium">Customer</th><th className="py-3 font-medium">Sold</th>
                      {d.kind === 'venue' && <th className="py-3 text-right font-medium">In</th>}
                      <th className="py-3 text-right font-medium">KES</th><th className="px-5 py-3 text-right font-medium">sUSD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num px-5 py-2.5 text-soft">{clock(r.at)}</td>
                        <td className="py-2.5">{r.customer}</td>
                        <td className="py-2.5">{r.what}<span className="block text-xs text-soft">{r.id}{r.refunded ? ', later refunded' : ''}</span></td>
                        {d.kind === 'venue' && <td className="num py-2.5 text-right">{r.admitted} of {r.people}</td>}
                        <td className="num py-2.5 text-right font-semibold">{kes(r.total_kes)}</td>
                        <td className="num px-5 py-2.5 text-right text-soft">{usd(r.total)}</td>
                      </tr>
                    ))}
                    {d.refunds.map((r) => (
                      <tr key={'back-' + r.id}>
                        <td className="num px-5 py-2.5 text-soft">{clock(r.at)}</td>
                        <td className="py-2.5">{r.customer}</td>
                        <td className="py-2.5">Refund<span className="block text-xs text-soft">{r.id}</span></td>
                        {d.kind === 'venue' && <td />}
                        <td className="num py-2.5 text-right font-semibold text-bad">−{kes(r.total_kes)}</td>
                        <td className="num px-5 py-2.5 text-right text-soft">−{usd(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink">
                      <td className="px-5 py-3 font-bold" colSpan={d.kind === 'venue' ? 4 : 3}>Net for the day</td>
                      <td className="num py-3 text-right font-bold">{kes(t.net_kes)}</td>
                      <td className="num px-5 py-3 text-right font-semibold">{usd(t.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
          <p className="text-xs text-soft">Every line is a payment settled by the SokoniPay contract on NEAR. The reference is the invoice number, which anyone can look up.</p>
        </>
      )}
    </main>
  )
}

function Figure({ name, kes: amount, micro, note, strong }: { name: string; kes: number; micro: number; note: string; strong?: boolean }) {
  return (
    <Card className={strong ? 'ring-2 ring-ink' : ''}>
      <p className="text-sm text-soft">{name}</p>
      <p className="num mt-1 text-3xl font-extrabold tracking-tight">{amount < 0 && '−'}<span className="mr-1 text-sm font-semibold text-soft">KES</span>{kes(Math.abs(amount))}</p>
      <p className="mt-2 text-xs text-soft">{usd(Math.abs(micro))} sUSD. {note}</p>
    </Card>
  )
}
