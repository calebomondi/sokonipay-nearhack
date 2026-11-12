import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import { shopLook } from '@shared/ui'

/**
 * A shop's code, drawn our own way so a SokoniPay code is recognisable and a home-made sticker looks wrong:
 * round dots, soft-cornered corner markers in the shop's own colour, and the shop's initials in the middle.
 * It is still an ordinary QR code. The middle is covered by the badge, which the highest error-correction
 * level allows for; dots stay near-black on white, with a clear margin, so phones read it.
 */
export function ShopCode({ value, name, size = 220 }: { value: string; name: string; size?: number }) {
  const look = shopLook(name)
  const { n, dots } = useMemo(() => {
    const qr = qrcode(0, 'H')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    const eye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7)
    // The badge covers a centred disc about a fifth of the width: well inside what level H can recover.
    const mid = (count - 1) / 2
    const hole = count * 0.2
    const out: [number, number][] = []
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c) && !eye(r, c) && Math.hypot(r - mid, c - mid) > hole / 2 + 0.6) out.push([c, r])
      }
    }
    return { n: count, dots: out }
  }, [value])

  const pad = 3 // quiet zone, in modules
  const box = n + pad * 2
  const eyes: [number, number][] = [[0, 0], [n - 7, 0], [0, n - 7]]
  const mid = box / 2
  const badge = n * 0.2
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={size} height={size} role="img" aria-label={`Code for ${name}`} shapeRendering="geometricPrecision">
      <rect width={box} height={box} rx={box * 0.07} fill="#fff" />
      <g transform={`translate(${pad} ${pad})`}>
        <g fill="#0c0e12">
          {dots.map(([x, y]) => <circle key={`${x}.${y}`} cx={x + 0.5} cy={y + 0.5} r={0.46} />)}
        </g>
        {eyes.map(([x, y]) => (
          <g key={`${x}.${y}`}>
            <rect x={x} y={y} width={7} height={7} rx={2.2} fill={look.ink} />
            <rect x={x + 1} y={y + 1} width={5} height={5} rx={1.5} fill="#fff" />
            <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} fill={look.ink} />
          </g>
        ))}
      </g>
      <circle cx={mid} cy={mid} r={badge / 2 + 0.4} fill="#fff" />
      <circle cx={mid} cy={mid} r={badge / 2 - 0.3} fill={look.tint} />
      <text x={mid} y={mid} textAnchor="middle" dominantBaseline="central" fontSize={badge * 0.42} fontWeight={800} fill={look.ink} style={{ fontFamily: 'var(--font-sans)' }}>{look.initials}</text>
    </svg>
  )
}
