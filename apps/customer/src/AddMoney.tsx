import { digits } from '@shared/Confirm'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@shared/api'
import { CoinIcon } from '@shared/Coin'
import { Button, Notice, Spinner, TxLink, toMicro, usd } from '@shared/ui'

type Token = { asset_id: string; symbol: string; decimals: number }
type Chain = { id: string; name: string; tokens: Token[] }
type Options = { chains: Chain[]; live: boolean; min: number; max: number }
type Quote = { chain_name: string; symbol: string; send: string; receive: number; least: number; fee: number; seconds: number }
type Deposit = {
  id: string; mode: 'preview' | 'live'; chain: string; symbol: string; send: string; expected: number; seconds: number
  deposit_address: string | null; memo: string | null; deadline: string | null
  status: 'waiting' | 'received' | 'converting' | 'done' | 'refunded' | 'failed'; credited: number; tx_hash: string | null
}

const STEPS: { key: Deposit['status']; text: string }[] = [
  { key: 'waiting', text: 'Waiting for your coins' },
  { key: 'received', text: 'Coins received' },
  { key: 'converting', text: 'Converting to dollars on NEAR' },
  { key: 'done', text: 'Added to your balance' },
]
const about = (s: number) => (s < 90 ? `About ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `About ${Math.round(s / 60)} minutes`)

/** Add money with whichever stablecoin the person holds, on whichever chain. NEAR Intents does the conversion. */
export default function AddMoney({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [options, setOptions] = useState<Options | null>(null)
  const [chain, setChain] = useState<Chain | null>(null)
  const [token, setToken] = useState<Token | null>(null)
  const [amount, setAmount] = useState('10')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [refundTo, setRefundTo] = useState('')
  const [deposit, setDeposit] = useState<Deposit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const lock = useRef(false)

  useEffect(() => {
    api<Options>('/api/funding/options').then(setOptions).catch((e) => setError(e.message))
  }, [])

  const micro = toMicro(Number(amount))
  const inRange = !!options && micro >= options.min && micro <= options.max

  // A fresh price each time the coin or the amount changes, after a short pause in typing.
  useEffect(() => {
    setQuote(null)
    if (!token || !inRange) return
    let stale = false
    setQuoting(true)
    const t = setTimeout(() => {
      api<Quote>('/api/funding/quote', { body: { asset_id: token.asset_id, amount: micro } })
        .then((q) => { if (!stale) { setQuote(q); setError('') } })
        .catch((e) => { if (!stale) setError(e.message) })
        .finally(() => { if (!stale) setQuoting(false) })
    }, 500)
    return () => { stale = true; clearTimeout(t) }
  }, [token, micro, inRange])

  // Follow a real deposit until it lands or fails.
  const depositId = deposit?.id
  const watching = deposit?.mode === 'live' && !['done', 'refunded', 'failed'].includes(deposit.status)
  useEffect(() => {
    if (!depositId || !watching) return
    const t = setInterval(() => {
      api<Deposit>(`/api/funding/deposits/${depositId}`).then((d) => { setDeposit(d); if (d.status === 'done') onAdded() }).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [depositId, watching, onAdded])

  const once = async (work: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const start = (live: boolean) => once(async () => {
    const d = await api<Deposit>('/api/funding/deposits', { body: { asset_id: token!.asset_id, amount: micro, ...(live ? { refund_to: refundTo.trim() } : {}) } })
    if (live) return setDeposit(d)
    // A preview has nothing to wait for: add the demo dollars straight away.
    setDeposit(await api<Deposit>(`/api/funding/deposits/${d.id}/simulate`, { method: 'POST' }))
    onAdded()
  })

  const pill = (on: boolean) => `flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium ${on ? 'bg-ink text-white' : 'bg-fill hover:bg-line'}`
  const field = 'mt-1 w-full rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40" role="dialog" aria-label="Add money">
      <div className="sheet max-h-[92%] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Add money</h2>
          <Button tone="quiet" onClick={onClose} className="!px-4 !py-2 text-sm">Close</Button>
        </div>

        {!options ? (
          error ? <Notice>{error}</Notice> : <div className="flex justify-center py-8"><Spinner /></div>
        ) : deposit ? (
          <Progress d={deposit} copied={copied} onCopy={(text) => { void navigator.clipboard?.writeText(text); setCopied(true) }} onClose={onClose} />
        ) : (
          <>
            <p className="text-sm text-soft">Pay in with the stablecoin you already hold. It arrives as dollars in your SokoniPay balance.</p>

            <div>
              <p className="text-sm font-medium">1. Which chain is it on?</p>
              <div className="mt-2 flex max-h-52 [scrollbar-width:thin] flex-wrap gap-2 overflow-y-auto">
                {options.chains.map((c) => (
                  <button key={c.id} type="button" aria-pressed={chain?.id === c.id} onClick={() => { setChain(c); setToken(c.tokens.length === 1 ? c.tokens[0] : null); setError('') }} className={pill(chain?.id === c.id)}><CoinIcon chain={c.id} />{c.name}</button>
                ))}
              </div>
            </div>

            {chain && (
              <div>
                <p className="text-sm font-medium">2. Which coin on {chain.name}?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {chain.tokens.map((t) => (
                    <button key={t.asset_id} type="button" aria-pressed={token?.asset_id === t.asset_id} onClick={() => { setToken(t); setError('') }} className={pill(token?.asset_id === t.asset_id)}><CoinIcon coin={t.symbol} />{t.symbol}</button>
                  ))}
                </div>
              </div>
            )}

            {token && (
              <label className="block text-sm font-medium">3. How much, in dollars?
                <input className={`num text-lg font-semibold ${field}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(digits(e.target.value, true))} />
                {!inRange && <span className="mt-1 block text-xs font-normal text-bad">Enter between {usd(options.min)} and {usd(options.max)}.</span>}
              </label>
            )}

            {token && inRange && (
              <div className="rounded-2xl bg-canvas p-4 text-sm">
                {quote ? (
                  <dl className="space-y-1.5">
                    <Row k="You send"><span className="inline-flex items-center gap-1.5"><CoinIcon coin={quote.symbol} size={16} /><span className="num font-semibold">{quote.send} {quote.symbol}</span> on {quote.chain_name}</span></Row>
                    <Row k="You get"><span className="num font-semibold">{usd(quote.receive)} sUSD</span></Row>
                    <Row k="Conversion cost"><span className="num">{usd(quote.fee)}</span></Row>
                    <Row k="Time">{about(quote.seconds)}</Row>
                    <p className="pt-1 text-xs text-soft">Live price from NEAR Intents.</p>
                  </dl>
                ) : quoting ? <p className="text-soft">Getting a live price from NEAR Intents…</p> : <p className="text-soft">No price for this coin right now.</p>}
              </div>
            )}

            {error && <Notice>{error}</Notice>}

            {quote && options.live && (
              <div className="space-y-3 rounded-2xl border border-line p-4">
                <p className="font-semibold">Send real {quote.symbol}</p>
                <label className="block text-sm font-medium">Your {quote.chain_name} address, for refunds
                  <input className={`text-sm ${field}`} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder="Where the coins come back if the swap fails" />
                </label>
                <Button disabled={busy || refundTo.trim().length < 2} onClick={() => start(true)} className="w-full">{busy ? 'Getting an address…' : 'Get a deposit address'}</Button>
                <p className="text-xs text-soft">This uses real money on {quote.chain_name}. SokoniPay runs on NEAR testnet, so the amount that arrives is shown as the same number of demo sUSD.</p>
              </div>
            )}
            {quote && (
              <div className="space-y-2">
                <Button tone={options.live ? 'quiet' : 'primary'} disabled={busy} onClick={() => start(false)} className="w-full">
                  {busy && !options.live ? 'Adding…' : `Try it with demo money: add ${usd(quote.receive)} sUSD`}
                </Button>
                <p className="text-xs text-soft">
                  {options.live ? 'Or skip the real transfer. ' : 'SokoniPay runs on NEAR testnet, so no real coins are taken. The price above is real; '}
                  the balance is topped up with demo dollars.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-soft">{k}</dt><dd className="text-right">{children}</dd></div>
}

function Progress({ d, copied, onCopy, onClose }: { d: Deposit; copied: boolean; onCopy: (text: string) => void; onClose: () => void }) {
  if (d.status === 'done') {
    return (
      <div className="space-y-4 text-center">
        <p className="num text-5xl font-extrabold tracking-tight text-good">+{usd(d.credited)}</p>
        <p className="text-sm">
          {d.mode === 'live' ? `Your ${d.send} ${d.symbol} from ${d.chain} arrived.` : `Demo money, priced as ${d.send} ${d.symbol} from ${d.chain}. No real coins moved.`}{' '}
          {d.tx_hash && <TxLink hash={d.tx_hash}>See it on NEAR</TxLink>}
        </p>
        <Button onClick={onClose} className="w-full">Done</Button>
      </div>
    )
  }
  if (d.status === 'refunded' || d.status === 'failed') {
    return (
      <div className="space-y-4">
        <Notice>{d.status === 'refunded' ? 'The swap didn’t go through, and your coins were sent back to the refund address you gave.' : 'This deposit didn’t complete. If you sent coins, they are returned to your refund address. Nothing was added to your balance.'}</Notice>
        <Button tone="quiet" onClick={onClose} className="w-full">Close</Button>
      </div>
    )
  }
  const at = STEPS.findIndex((s) => s.key === d.status)
  return (
    <div className="space-y-4">
      <p className="text-sm">Send exactly <span className="num font-semibold">{d.send} {d.symbol}</span> on <span className="font-semibold">{d.chain}</span> to this address, from any wallet or exchange.</p>
      {d.deposit_address && (
        <div className="space-y-3 rounded-2xl bg-canvas p-4 text-center">
          <div className="mx-auto w-fit rounded-2xl bg-white p-2"><QRCodeSVG value={d.deposit_address} size={148} fgColor="#0c0e12" bgColor="#ffffff" level="M" /></div>
          <p className="num break-all text-sm font-medium">{d.deposit_address}</p>
          {d.memo && <p className="text-sm font-semibold text-bad">Memo (required): <span className="num">{d.memo}</span></p>}
          <Button tone="quiet" onClick={() => onCopy(d.deposit_address!)} className="!py-2 text-sm">{copied ? 'Copied' : 'Copy address'}</Button>
        </div>
      )}
      <p className="text-xs text-soft">
        Only send {d.symbol} on {d.chain}. Anything else sent here may be lost.
        {d.deadline ? ` The address works until ${new Date(d.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}
      </p>
      <ol className="space-y-2 text-sm" aria-live="polite">
        {STEPS.map((s, n) => (
          <li key={s.key} className={`flex items-center gap-3 ${n > at ? 'text-soft' : ''}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${n < at ? 'bg-good' : n === at ? 'bg-iris' : 'bg-line'}`} />
            {s.text}{n === at ? '…' : ''}
          </li>
        ))}
      </ol>
      <p className="text-xs text-soft">You can close this. The money is added when the coins arrive and you open Add money again or reload.</p>
    </div>
  )
}
