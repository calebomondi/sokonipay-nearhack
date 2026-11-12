import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { EXPLORER_ACCOUNT } from './ui'

export type MenuItem = { label: string; onClick?: () => void; href?: string }

/**
 * The signed-in person's picture. Tapping it opens a small menu: who they are, their NEAR account,
 * the actions passed in, and Sign out. The picture is the one on their Google account, or their
 * initials when there is none or it does not load.
 */
export function Profile({ name, nearId, items = [], align = 'left' }: { name: string; nearId?: string; items?: MenuItem[]; align?: 'left' | 'right' }) {
  const { session, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const meta = (session?.user.user_metadata ?? {}) as { avatar_url?: string; picture?: string; full_name?: string }
  const photo = meta.avatar_url || meta.picture
  const email = session?.user.email
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const row = 'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-fill'
  const pick = (run?: () => void) => () => { setOpen(false); run?.() }

  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Your account"
        className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-iris text-sm font-bold text-white ring-2 transition-shadow ${open ? 'ring-iris' : 'ring-transparent hover:ring-line'}`}>
        {photo && !broken ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" /> : initials}
      </button>
      {open && (
        <div role="menu" className={`rise absolute top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-3xl bg-card p-2 shadow-[0_16px_40px_rgb(12_14_18/0.18)] ring-1 ring-line ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="px-3 pb-2 pt-2.5">
            <p className="truncate font-semibold">{meta.full_name || name}</p>
            {email && <p className="truncate text-sm text-soft">{email}</p>}
          </div>
          {nearId && (
            <div className="mx-1 mb-1 rounded-2xl bg-canvas px-3 py-2.5">
              <p className="text-xs text-soft">NEAR account</p>
              <p className="break-all text-sm font-medium">{nearId}</p>
              <p className="mt-1.5 flex gap-3 text-xs font-semibold">
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(nearId); setCopied(true) }} className="hover:underline">{copied ? 'Copied' : 'Copy'}</button>
                <a href={EXPLORER_ACCOUNT + nearId} target="_blank" rel="noreferrer" className="hover:underline">View on NEAR</a>
              </p>
            </div>
          )}
          {items.map((i) => i.href
            ? <a key={i.label} role="menuitem" href={i.href} target="_blank" rel="noreferrer" onClick={pick()} className={row}>{i.label}<Arrow /></a>
            : <button key={i.label} role="menuitem" type="button" onClick={pick(i.onClick)} className={row}>{i.label}</button>)}
          <div className="mx-3 my-1 border-t border-line" />
          <button role="menuitem" type="button" onClick={pick(() => void signOut())} className={`${row} text-bad`}>Sign out</button>
        </div>
      )}
    </div>
  )
}

function Arrow(): ReactNode {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-soft"><path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" /></svg>
}
