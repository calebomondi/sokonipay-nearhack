import { Profile } from '@shared/Profile'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@shared/api'
import { Button, Card, EXPLORER_ACCOUNT, Notice, Spinner, fmt, when } from '@shared/ui'

type Data = {
  shops: { near_id: string; name: string; kind: string; place: string; status: string; hours: { open: string; close: string } | null; verified_onchain: boolean; owner: string | null; created_at: string }[]
  stats: { customers: number; orders: Record<string, number>; gas_reserve_near: number }
  recent: { id: string; shop: string; status: string; kind: string | null; total: number | null; goal: string; at: string }[]
}
const CHIP: Record<string, string> = { pending: 'bg-amber-wash text-amber', approved: 'bg-good-wash text-good', suspended: 'bg-bad-wash text-bad' }

/** For SokoniPay staff: verify new shops, take a shop down, and keep an eye on the service. */
export default function Admin() {
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => api<Data>('/api/admin').then(setD).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load()
  }, [load])

  const review = async (near_id: string, action: 'approve' | 'suspend') => {
    setBusy(near_id)
    setError('')
    try {
      await api(`/api/admin/shops/${near_id}/${action}`, { method: 'POST' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  if (!d) return <div className="flex min-h-dvh items-center justify-center">{error ? <Notice>{error}</Notice> : <Spinner />}</div>
  const waiting = d.shops.filter((s) => s.status === 'pending')
  const paid = d.stats.orders.paid ?? 0

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-5 pb-12 pt-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-soft">SokoniPay</p>
          <h1 className="text-4xl font-extrabold tracking-tight">Admin</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/" className="rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line">My shop</Link>
          <Profile name="Admin" align="right" />
        </div>
      </header>
      {error && <Notice>{error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Waiting for review', String(waiting.length), 'Shops customers can’t see yet'],
          ['Customers', String(d.stats.customers), 'People with an account'],
          ['Paid orders', String(paid), `${d.stats.orders.refused ?? 0} refused by the contract`],
          ['Gas reserve', `${d.stats.gas_reserve_near} NEAR`, 'Pays for new accounts and their gas'],
        ].map(([label, value, note]) => (
          <Card key={label}>
            <p className="text-sm text-soft">{label}</p>
            <p className="num mt-1 text-4xl font-extrabold tracking-tight">{value}</p>
            <p className="mt-2 text-xs text-soft">{note}</p>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="px-1 text-xl font-bold">Shops</h2>
        <Card className="!p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-soft">
              <tr><th className="px-5 py-3 font-medium">Shop</th><th className="py-3 font-medium">Type</th><th className="py-3 font-medium">Owner</th><th className="py-3 font-medium">Opened</th><th className="py-3 font-medium">Status</th><th className="px-5 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.shops.map((s) => (
                <tr key={s.near_id}>
                  <td className="px-5 py-3">
                    <span className="block font-semibold">{s.name}</span>
                    <a href={EXPLORER_ACCOUNT + s.near_id} target="_blank" rel="noreferrer" className="text-xs text-soft hover:underline">{s.near_id}</a>
                    {s.place && <span className="block text-xs text-soft">{s.place}</span>}
                  </td>
                  <td className="py-3">{s.kind === 'venue' ? 'Venue' : s.kind === 'counter' ? 'Counter' : 'Food stall'}{s.hours ? <span className="block text-xs text-soft">{s.hours.open} to {s.hours.close}</span> : null}</td>
                  <td className="py-3 text-soft">{s.owner ?? 'Unknown'}</td>
                  <td className="py-3 text-soft">{when(s.created_at)}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${CHIP[s.status] ?? 'bg-fill'}`}>{s.status}</span>
                    {s.verified_onchain !== (s.status === 'approved') && <span className="mt-1 block text-xs text-bad">Onchain register disagrees</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {s.status === 'approved' ? (
                      <Button tone="quiet" disabled={busy === s.near_id} onClick={() => review(s.near_id, 'suspend')} className="!px-4 !py-2 text-sm">{busy === s.near_id ? 'Working…' : 'Suspend'}</Button>
                    ) : (
                      <Button disabled={busy === s.near_id} onClick={() => review(s.near_id, 'approve')} className="!px-4 !py-2 text-sm">{busy === s.near_id ? 'Verifying…' : 'Verify shop'}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.shops.length === 0 && <p className="p-5 text-sm text-soft">No shops yet.</p>}
        </Card>
        <p className="px-1 text-xs text-soft">Verifying writes the shop to the onchain register. Customers’ agents refuse to pay a shop that isn’t on it.</p>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-xl font-bold">Latest orders</h2>
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {d.recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{o.shop}</span>
                  <span className="block truncate text-xs text-soft">“{o.goal}”, {when(o.at)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="num block font-semibold">{o.total != null ? `${fmt(o.total)}` : ''}</span>
                  <span className="block text-xs capitalize text-soft">{o.status}</span>
                </span>
              </li>
            ))}
          </ul>
          {d.recent.length === 0 && <p className="p-5 text-sm text-soft">No orders yet.</p>}
        </Card>
      </section>
    </main>
  )
}
