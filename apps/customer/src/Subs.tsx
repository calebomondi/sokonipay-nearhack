import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@shared/api'
import { useConfirm } from '@shared/Confirm'
import { Button, Card, Notice, ShopIcon, fmt, when } from '@shared/ui'

type Sub = {
  id: string; shop: string; shop_id: string; plan: string; amount: number; every: string
  status: 'active' | 'paused' | 'needs_money' | 'cancelled'; note: string; next_due_ms: number
  payments: { id: string; at: string; total: number; refunded: boolean }[]
}
export type PlanRow = { id: string; name: string; price_kes: number; price: number; every: string }

const LOOK: Record<Sub['status'], { word: string; cls: string }> = {
  active: { word: 'Active', cls: 'bg-good-wash text-good' },
  paused: { word: 'Paused', cls: 'bg-fill text-ink' },
  needs_money: { word: 'Needs money', cls: 'bg-bad-wash text-bad' },
  cancelled: { word: 'Cancelled', cls: 'bg-fill text-soft' },
}

/** Everything billed on a schedule. Your agent pays each bill only while you stay subscribed. */
export default function Subs({ onChanged, onAddMoney }: { onChanged: () => void; onAddMoney: () => void }) {
  const [subs, setSubs] = useState<Sub[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)

  const load = useCallback(() => api<Sub[]>('/api/subscriptions').then(setSubs).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 8000) // a bill can be paid while this is open
    return () => clearInterval(t)
  }, [load])

  const { ask, sheet } = useConfirm()
  const act = async (s: Sub, action: 'pause' | 'resume' | 'cancel') => {
    if (busy) return
    if (action === 'cancel' && !(await ask({ title: `Cancel ${s.plan}?`, body: `${s.shop} can’t bill you for it again. To come back you would subscribe afresh.`, yes: 'Cancel subscription', no: 'Keep it', danger: true }))) return
    setBusy(s.id)
    try {
      await api(`/api/subscriptions/${s.id}/${action}`, { method: 'POST' })
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      await load()
      onChanged()
    }
  }

  if (subs === null) return error ? <Notice>{error}</Notice> : <div className="space-y-3"><div className="skeleton h-24 !rounded-3xl" /><div className="skeleton h-24 !rounded-3xl" /></div>
  const live = subs.filter((s) => s.status !== 'cancelled')
  const ended = subs.filter((s) => s.status === 'cancelled')
  return (
    <>
      {sheet}
      {error && <Notice>{error}</Notice>}
      {live.length === 0 && (
        <Card>
          <h2 className="text-lg font-bold">No subscriptions</h2>
          <p className="mt-1 text-sm text-soft">When a shop offers something billed weekly or monthly, you can subscribe on its page. Your agent then pays each bill inside your limits, and only while you stay subscribed.</p>
        </Card>
      )}
      <ul className="space-y-2">
        {[...live, ...ended].map((s) => {
          const look = LOOK[s.status]
          const open = opened === s.id
          return (
            <li key={s.id} className="rounded-3xl bg-card">
              <button type="button" onClick={() => setOpened(open ? null : s.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <ShopIcon name={s.shop} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{s.plan}</span>
                  <span className="block truncate text-sm text-soft">{s.shop} · {fmt(s.amount)} {s.every}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${look.cls}`}>{look.word}</span>
              </button>
              <div className={`reveal ${open ? 'open' : ''}`}>
                <div>
                  <div className="space-y-3 border-t border-line px-4 py-4 text-sm">
                    {s.status === 'active' && <p>Next payment: <span className="font-semibold">{s.next_due_ms <= Date.now() ? 'due now' : when(s.next_due_ms)}</span></p>}
                    {s.note && <p className={s.status === 'needs_money' ? 'font-medium text-bad' : 'text-soft'}>{s.note}</p>}
                    {s.payments.length > 0 && (
                      <ul className="divide-y divide-line rounded-2xl bg-canvas px-3">
                        {s.payments.map((p) => (
                          <li key={p.id}>
                            <Link to={`/r/${p.id}`} className="flex justify-between gap-3 py-2 hover:underline">
                              <span className="text-soft">{when(p.at)}{p.refunded ? ', refunded' : ''}</span>
                              <span className="num font-semibold text-bad">−{fmt(p.total)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.status !== 'cancelled' && (
                      <div className="flex flex-wrap gap-2">
                        {s.status === 'needs_money' && <Button onClick={onAddMoney} className="!py-2 text-sm">Add money</Button>}
                        {s.status === 'paused'
                          ? <Button tone="dark" disabled={busy === s.id} onClick={() => act(s, 'resume')} className="!py-2 text-sm">Resume</Button>
                          : <Button tone="quiet" disabled={busy === s.id} onClick={() => act(s, 'pause')} className="!py-2 text-sm">Pause</Button>}
                        <button type="button" disabled={busy === s.id} onClick={() => act(s, 'cancel')} className="rounded-full px-4 py-2 text-sm font-semibold text-bad hover:bg-bad-wash disabled:opacity-50">{busy === s.id ? 'Working…' : 'Cancel'}</button>
                      </div>
                    )}
                    <p className="text-xs text-soft">{s.shop} can bill exactly {fmt(s.amount)}, once {s.every === 'every 5 minutes' ? s.every : `per ${s.every.replace(/^a /, '')}`}. The contract refuses anything else.</p>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** On a shop's page: what it bills on a schedule, with a Subscribe button. */
export function Plans({ plans, shop }: { plans: PlanRow[]; shop: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')
  const { ask, sheet } = useConfirm()
  if (!plans?.length) return null
  const join = async (p: PlanRow) => {
    if (busy) return
    if (!(await ask({ title: `Subscribe to ${p.name}?`, body: `${shop} can bill you ${fmt(p.price)} ${p.every}, starting now. You can pause or cancel any time.`, yes: 'Subscribe' }))) return
    setBusy(p.id)
    setError('')
    try {
      await api('/api/subscriptions', { body: { plan_id: p.id } })
      setDone(p.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card className="space-y-3">
      {sheet}
      <h2 className="text-lg font-bold">Subscriptions</h2>
      <ul className="divide-y divide-line">
        {plans.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-3">
            <span>
              <span className="block font-semibold">{p.name}</span>
              <span className="num text-sm text-soft">{fmt(p.price)} {p.every}</span>
            </span>
            {done === p.id
              ? <Link to="/subs" className="rounded-full bg-good-wash px-3.5 py-2 text-sm font-semibold text-good">Subscribed. View</Link>
              : <Button tone="dark" disabled={busy !== null} onClick={() => join(p)} className="!px-4 !py-2 text-sm">{busy === p.id ? 'Subscribing…' : 'Subscribe'}</Button>}
          </li>
        ))}
      </ul>
      {error && <Notice>{error}</Notice>}
      <p className="text-xs text-soft">Only you can subscribe: your agent can’t. Once you do, your agent pays each bill inside your limits, and the contract refuses a bill that is early or for a different amount.</p>
    </Card>
  )
}
