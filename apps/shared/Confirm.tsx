import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui'

type Ask = { title: string; body?: ReactNode; yes: string; no?: string; danger?: boolean }

/**
 * An in-app "are you sure?". `ask(...)` resolves true or false; `sheet` is rendered once by the caller.
 * It comes up from the bottom on a phone and sits in the middle on a wide screen.
 */
export function useConfirm(): { ask: (a: Ask) => Promise<boolean>; sheet: ReactNode } {
  const [open, setOpen] = useState<Ask | null>(null)
  const answer = useRef<(yes: boolean) => void>(() => {})
  const ask = useCallback((a: Ask) => new Promise<boolean>((resolve) => { answer.current = resolve; setOpen(a) }), [])
  const close = useCallback((yes: boolean) => { answer.current(yes); setOpen(null) }, [])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, close])
  // Drawn on the page itself, not inside the frosted column: a blurred parent would trap a fixed layer and let it scroll away.
  const sheet = open && createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4 print:hidden" role="alertdialog" aria-modal="true" aria-label={open.title}
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(false) }}>
      <div className="sheet w-full max-w-md space-y-3 rounded-t-3xl bg-card p-6 text-left shadow-[0_16px_40px_rgb(12_14_18/0.18)] sm:rounded-3xl">
        <h2 className="text-xl font-bold leading-snug">{open.title}</h2>
        {open.body && <div className="text-sm text-soft">{open.body}</div>}
        <div className="flex gap-2 pt-2">
          <Button type="button" tone="quiet" onClick={() => close(false)} className="flex-1">{open.no ?? 'Cancel'}</Button>
          <Button type="button" autoFocus onClick={() => close(true)} className={`flex-1 ${open.danger ? '!bg-bad hover:!bg-bad' : ''}`}>{open.yes}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
  return { ask, sheet }
}

/** Keep only what makes a number, for amount boxes: digits and, if allowed, one decimal point. */
export const digits = (text: string, decimal = false) => {
  const clean = text.replace(decimal ? /[^\d.]/g : /\D/g, '')
  const [whole, ...rest] = clean.split('.')
  return (rest.length ? `${whole}.${rest.join('')}` : whole).slice(0, 12)
}
