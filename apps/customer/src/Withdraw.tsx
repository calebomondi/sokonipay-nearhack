import { useEffect, useRef, useState } from 'react'
import { api } from '@shared/api'
import { CoinIcon } from './Coin'
import { Button, Notice, Spinner, TxLink, fmt, toMicro, usd } from '@shared/ui'

type Token = { asset_id: string; symbol: string; decimals: number }
type Chain = { id: string; name: string; tokens: Token[] }
type Options = { chains: Chain[]; min: number }
type Quote = { chain_name: string; symbol: string; receive: string; seconds: number }
type Done = { send: string; symbol: string; chain: string; credited: number; deposit_address: string; tx_hash: string | null }

/** Take money out as whichever stablecoin, on whichever chain, the person wants. NEAR Intents prices it. */
export default function Withdraw({ balance, onClose, onDone }: { balance: number; onClose: () => void; onDone: () => void }) {
  const [options, setOptions] = useState<Options | null>(null)
  const [chain, setChain] = useState<Chain | null>(null)
  const [token, setToken] = useState<Token | null>(null)
  const [amount, setAmount] = useState('5')
  const [address, setAddress] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  useEffect(() => {
    api<Options>('/api/funding/options').then(setOptions).catch((e) => setError(e.message))
  }, [])

  const micro = toMicro(Number(amount))
  const inRange = !!options && micro >= options.min && micro <= balance

  useEffect(() => {
    setQuote(null)
    if (!token || !inRange) return
    let stale = false
    setQuoting(true)
    const t = setTimeout(() => {
      api<Quote>('/api/funding/payout-quote', { body: { asset_id: token.asset_id, amount: micro } })
        .then((q) => { if (!stale) { setQuote(q); setError('') } })
        .catch((e) => { if (!stale) setError(e.message) })
        .finally(() => { if (!stale) setQuoting(false) })
    }, 500)
    return () => { stale = true; clearTimeout(t) }
  }, [token, micro, inRange])

  const send = async () => {
    if (lock.current) return // a second tap before the button disables
    lock.current = true
    setBusy(true)
    setError('')
    try {
      setDone(await api<Done>('/api/funding/withdrawals', { body: { asset_id: token!.asset_id, amount: micro, address: address.trim() } }))
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const pill = (on: boolean) => `flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium ${on ? 'bg-ink text-white' : 'bg-fill hover:bg-line'}`
  const field = 'mt-1 w-full rounded-2xl bg-fill px-4 py-3 outline-none placeholder:text-soft focus:ring-2 focus:ring-iris'

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40" role="dialog" aria-label="Withdraw">
      <div className="sheet max-h-[92%] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Withdraw</h2>
          <Button tone="quiet" onClick={onClose} className="!px-4 !py-2 text-sm">Close</Button>
        </div>

        {!options ? (
          error ? <Notice>{error}</Notice> : <div className="flex justify-center py-8"><Spinner /></div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <p className="num text-5xl font-extrabold tracking-tight text-bad">−{usd(done.credited)}</p>
            <p className="text-sm">
              {usd(done.credited)} sUSD left your SokoniPay balance, priced as {done.send} {done.symbol} on {done.chain}.{' '}
              {done.tx_hash && <TxLink hash={done.tx_hash}>See it on NEAR</TxLink>}
            </p>
            <Notice tone="plain">This is a demo on NEAR testnet, so no real {done.symbol} was sent to {done.deposit_address}. The demo dollars are now in your own NEAR account.</Notice>
            <Button onClick={onClose} className="w-full">Done</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-soft">Take money out as the stablecoin you want, on the chain you want. You have <span className="num font-medium text-ink">{usd(balance)} sUSD</span> ({fmt(balance)}).</p>

            <div>
              <p className="text-sm font-medium">1. Which chain should it arrive on?</p>
              <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
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
                <input className={`num text-lg font-semibold ${field}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                {!inRange && <span className="mt-1 block text-xs font-normal text-bad">Enter between {usd(options.min)} and your balance of {usd(balance)}.</span>}
              </label>
            )}

            {token && inRange && (
              <div className="rounded-2xl bg-canvas p-4 text-sm">
                {quote ? (
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-soft">Leaves your balance</dt><dd className="num font-semibold">{usd(micro)} sUSD</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-soft">You would get</dt><dd className="inline-flex items-center gap-1.5"><CoinIcon coin={quote.symbol} size={16} /><span><span className="num font-semibold">{quote.receive} {quote.symbol}</span> on {quote.chain_name}</span></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-soft">Time</dt><dd>About {Math.max(5, Math.round(quote.seconds / 5) * 5)} seconds</dd></div>
                    <p className="pt-1 text-xs text-soft">Live price from NEAR Intents.</p>
                  </dl>
                ) : quoting ? <p className="text-soft">Getting a live price from NEAR Intents…</p> : <p className="text-soft">No price for this coin right now.</p>}
              </div>
            )}

            {quote && (
              <label className="block text-sm font-medium">4. Your {quote.chain_name} address
                <input className={`text-sm ${field}`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`Where the ${quote.symbol} should arrive`} />
              </label>
            )}

            {error && <Notice>{error}</Notice>}

            {quote && (
              <div className="space-y-2">
                <Button disabled={busy || address.trim().length < 4} onClick={send} className="w-full">{busy ? 'Withdrawing…' : `Withdraw ${usd(micro)} sUSD`}</Button>
                <p className="text-xs text-soft">SokoniPay runs on NEAR testnet. The price is real and the money does leave your balance, but no real coins are sent to the address. Only you can withdraw: your agent’s key can’t.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
