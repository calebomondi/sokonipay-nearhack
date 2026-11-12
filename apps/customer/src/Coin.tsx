import { useState } from 'react'

// Logos kept in /public/coins, so nothing is fetched from another site. Anything not listed gets initials.
const CHAINS = new Set(['eth', 'sol', 'base', 'arb', 'tron', 'bsc', 'pol', 'op', 'avax', 'ton', 'near', 'stellar', 'sui', 'aptos', 'gnosis', 'scroll', 'monad', 'plasma'])
const COINS: Record<string, string> = {
  USDC: 'usdc', USDCX: 'usdc', USDT: 'usdt', USDT0: 'usdt', DAI: 'dai', XDAI: 'dai', FRAX: 'frax', USDE: 'usde', USD1: 'usd1',
}

/** The logo of a chain (by its id) or a stablecoin (by its symbol), in a small circle. */
export function CoinIcon({ chain, coin, size = 20 }: { chain?: string; coin?: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const file = chain ? (CHAINS.has(chain) ? `chain-${chain}` : null) : COINS[(coin ?? '').toUpperCase()] ? `coin-${COINS[coin!.toUpperCase()]}` : null
  const box = { width: size, height: size }
  if (!file || broken) {
    return (
      <span aria-hidden style={{ ...box, fontSize: size * 0.42 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-line font-bold uppercase text-soft">
        {(chain ?? coin ?? '?').slice(0, coin ? 1 : 2)}
      </span>
    )
  }
  return <img src={`/coins/${file}.png`} alt="" aria-hidden style={box} onError={() => setBroken(true)} className="shrink-0 rounded-full bg-white object-cover" />
}
