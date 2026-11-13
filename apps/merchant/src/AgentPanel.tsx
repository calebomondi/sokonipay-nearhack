import { useEffect, useRef, useState } from 'react'
import { api, send as post, stream } from '@shared/api'
import { Button, Notice } from '@shared/ui'
import { useVoice } from '@shared/useVoice'

type Msg = { role: 'user' | 'agent'; text: string }
type Thread = { id: string; title: string; at: string }
type Ev = { t: 'thread'; id: string; title: string } | { t: 'step'; text: string } | { t: 'say'; text: string }

const IDEAS = ['How did we do today?', 'What sells best?', 'Anything I should look at?', 'How much can I withdraw?']
const SPEAK_KEY = 'sokoni.speak'
let playing: HTMLAudioElement | null = null
async function say(text: string): Promise<void> {
  playing?.pause()
  const url = URL.createObjectURL(await (await post('/api/voice/speak', { text })).blob())
  playing = new Audio(url)
  playing.onended = () => URL.revokeObjectURL(url)
  await playing.play()
}

/**
 * The owner asks the shop's agent about the business. A round button in the corner opens a panel that
 * slides in beside the console, so the figures stay in view. The agent reads; it changes nothing.
 */
export function AgentPanel({ shop }: { shop: string }) {
  const [open, setOpen] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])
  const [thread, setThread] = useState<string | null>(null)
  const [listing, setListing] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [steps, setSteps] = useState<string[] | null>(null) // not null while the agent is working
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [voice, setVoice] = useState(false)
  const [aloud, setAloud] = useState(() => localStorage.getItem(SPEAK_KEY) === '1')
  const busy = useRef(false)
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLInputElement>(null)

  const loadThreads = () => api<{ chats: Thread[]; voice?: boolean }>('/api/console/chats').then((r) => { setThreads(r.chats); setVoice(!!r.voice) }).catch((e) => setError(e.message))
  useEffect(() => { if (open) void loadThreads() }, [open])
  // Focus the box as the panel opens, so typing straight away lands there and not on the page behind.
  useEffect(() => { if (open) box.current?.focus({ preventScroll: true }) }, [open])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs.length, steps?.length])
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  const show = (id: string | null) => {
    setListing(false)
    setThread(id)
    setMsgs([])
    setError('')
    if (id) api<{ messages: Msg[] }>(`/api/console/chats/${id}`).then((r) => setMsgs(r.messages)).catch((e) => setError(e.message))
  }

  async function ask(words = text) {
    const said = words.trim()
    if (!said || busy.current) return
    busy.current = true
    setText('')
    setError('')
    setMsgs((m) => [...m, { role: 'user', text: said }])
    setSteps([])
    try {
      await stream<Ev>('/api/console/chat', { text: said, thread }, (e) => {
        if (e.t === 'thread') setThread(e.id)
        if (e.t === 'step') setSteps((s) => [...(s ?? []), e.text])
        if (e.t === 'say') {
          setMsgs((m) => [...m, { role: 'agent', text: e.text }])
          if (aloud && voice) void say(e.text).catch(() => {})
        }
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
      setSteps(null)
      void loadThreads()
    }
  }

  // Tap and speak. The recording stops by itself when the owner stops talking; what was heard is sent as an ordinary message.
  const voiceIn = useVoice((heard) => void ask(heard), setError)
  const { hearing, level } = voiceIn
  const listen = () => {
    if (busy.current && hearing === 'off') return
    setError('')
    void voiceIn.listen()
  }

  const pill = 'shrink-0 rounded-full bg-fill px-3 py-1.5 text-sm font-medium hover:bg-line disabled:opacity-50'
  const working = steps !== null
  return (
    <div className="print:hidden">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-iris py-3 pl-4 pr-5 font-semibold text-white shadow-[0_12px_30px_rgb(0_0_255/0.30)] hover:bg-iris-deep">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-6.3l-4.2 3v-3H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5zM8.5 10h7M8.5 13.2h4.5" /></svg>
          Ask your agent
        </button>
      )}
      <aside aria-label="Your agent" aria-hidden={!open}
        className={`fixed inset-y-3 right-3 z-40 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-[28px] bg-card shadow-[0_20px_60px_rgb(12_14_18/0.22)] ring-1 ring-line transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-[110%]'}`}>
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold leading-tight">Your agent</h2>
            <p className="truncate text-xs text-soft">{shop} · reads your figures, changes nothing</p>
          </div>
          {voice && (
            <button type="button" aria-pressed={aloud} aria-label={aloud ? 'Stop reading answers aloud' : 'Read answers aloud'}
              onClick={() => { const on = !aloud; setAloud(on); localStorage.setItem(SPEAK_KEY, on ? '1' : '0'); if (!on) playing?.pause() }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${aloud ? 'bg-iris text-white' : 'bg-fill hover:bg-line'}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z" />{aloud ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5M21 9.5l-5 5" />}</svg>
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill hover:bg-line">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m2 2 10 10M12 2 2 12" /></svg>
          </button>
        </header>
        <div className="flex items-center gap-2 px-4 pt-3">
          <button type="button" onClick={() => setListing(!listing)} disabled={working} className={pill}>{listing ? 'Back' : 'Chats'}</button>
          <button type="button" onClick={() => show(null)} disabled={working || (!thread && !listing)} className={pill}>New chat</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {listing ? (
            threads.length === 0 ? <p className="text-sm text-soft">No chats yet.</p> : (
              <ul className="space-y-2">
                {threads.map((t) => (
                  <li key={t.id} className={`flex items-center rounded-2xl bg-canvas pr-1 ${t.id === thread ? 'ring-2 ring-iris' : ''}`}>
                    <button type="button" onClick={() => show(t.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                      <span className="block truncate text-sm font-semibold">{t.title}</span>
                      <span className="block text-xs text-soft">{new Date(/Z|[+-]\d\d:?\d\d$/.test(t.at) ? t.at : t.at + 'Z').toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                    <button type="button" aria-label={`Delete ${t.title}`} onClick={() => { void api(`/api/console/chats/${t.id}`, { method: 'DELETE' }).then(() => { if (t.id === thread) show(null); void loadThreads() }) }} className="rounded-full p-2 text-soft hover:bg-bad-wash hover:text-bad">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <>
              {msgs.length === 0 && !working && (
                <div className="rounded-2xl bg-canvas p-4">
                  <p className="text-sm">Ask about sales, stock, subscribers, refunds or your balance. It answers from this shop’s real figures.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {IDEAS.map((i) => <button key={i} type="button" onClick={() => ask(i)} className="rounded-full bg-card px-3 py-1.5 text-left text-sm font-medium ring-1 ring-line hover:bg-fill">{i}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m, n) => (
                <div key={n} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <p className={`max-w-[90%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'rounded-br-md bg-ink text-white' : 'rounded-bl-md bg-canvas'}`}>{m.text}</p>
                  {voice && m.role === 'agent' && <button type="button" onClick={() => void say(m.text).catch(() => {})} className="ml-2 mt-1 text-xs font-medium text-soft hover:text-ink">Listen</button>}
                </div>
              ))}
              {working && (
                <div className="space-y-1.5" aria-live="polite">
                  {steps!.map((s, n) => <p key={n} className="rise flex items-center gap-2 text-xs font-medium text-soft"><span className="h-1.5 w-1.5 rounded-full bg-line" />{s}</p>)}
                  <p className="dots w-fit rounded-3xl rounded-bl-md bg-canvas px-4 py-3" aria-label="Your agent is thinking"><i /><i /><i /></p>
                </div>
              )}
              {error && <Notice>{error}</Notice>}
              <div ref={end} />
            </>
          )}
        </div>

        {!listing && (
          <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void ask() }}>
            {voice && (
              <button type="button" onClick={listen} disabled={working || hearing === 'working'} aria-pressed={hearing === 'on'} aria-label={hearing === 'on' ? 'Stop and send' : 'Speak to your agent'}
                className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-60 ${hearing === 'on' ? 'bg-bad text-white' : 'bg-fill hover:bg-line'}`}>
                {hearing === 'on' && <span className="absolute inset-0 rounded-full bg-bad/35 transition-transform duration-75" style={{ transform: `scale(${1 + level * 0.7})` }} aria-hidden />}
                {hearing === 'on' ? <span className="relative h-3.5 w-3.5 rounded-[3px] bg-white" aria-hidden />
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></svg>}
              </button>
            )}
            <input ref={box} value={text} onChange={(e) => setText(e.target.value)} maxLength={600} disabled={working || hearing !== 'off'} aria-label="Ask your agent"
              placeholder={hearing === 'on' ? 'Listening… stop talking to send' : hearing === 'working' ? 'Working out what you said…' : working ? 'Reading your figures…' : 'Ask about your shop'}
              className="min-w-0 flex-1 rounded-full bg-fill px-4 py-2.5 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris disabled:opacity-60" />
            <Button disabled={working || !text.trim()} aria-label="Send" className="!px-3.5 !py-2.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M6 11l6-6 6 6" /></svg>
            </Button>
          </form>
        )}
      </aside>
    </div>
  )
}
