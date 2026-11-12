import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type ReceiptData } from '@shared/api'
import { Receipt } from '@shared/Receipt'
import { TicketPass } from '@shared/TicketPass'
import { Notice, Spinner, fmt, Logo } from '@shared/ui'

/** Read straight from the contract, so anyone with the link can check a receipt. No sign-in needed. */
export default function ReceiptPage() {
  const { id = '' } = useParams()
  const [r, setR] = useState<ReceiptData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () => api<ReceiptData>(`/api/receipts/${id}`).then(setR).catch((e) => setError(e.message))
    load()
    // A ticket changes while it is on screen: the gate lets people in, the venue closes.
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [id])
  return (
    <main className="mx-auto flex panel w-full max-w-md flex-col gap-5 px-4 py-5">
      <Link to="/" aria-label="SokoniPay home" className="w-fit rounded-full bg-fill px-2.5 py-1.5 hover:bg-line"><Logo size={26} /></Link>
      {error && !r ? <Notice>{error}</Notice> : !r ? <div className="flex justify-center py-10"><Spinner /></div> : r.status === 'Paid' ? (
        r.kind === 'Ticket' ? <TicketPass r={r} /> : <Receipt r={r} />
      ) : (
        <Notice tone={r.status === 'Open' ? 'plain' : 'good'}>
          {r.status === 'Open' ? `Invoice ${r.id} hasn’t been paid yet, so there is no receipt.`
            : `${r.shop} refunded this ${r.kind === 'Ticket' ? 'ticket' : 'payment'} in full: ${fmt(r.total)} went back to ${r.payers.length > 1 ? 'everyone who paid' : 'your balance'}.${r.kind === 'Ticket' ? ' The ticket no longer opens the gate.' : ''}`}
        </Notice>
      )}
      <p className="text-center text-xs text-soft">Read live from the SokoniPay contract on NEAR testnet.</p>
    </main>
  )
}
