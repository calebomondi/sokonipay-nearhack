import { useConfirm } from '@shared/Confirm'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, send as post, stream, type Ev, type Line } from '@shared/api'
import { Button, Notice, ShopIcon, fmt, usd } from '@shared/ui'
import { useVoice } from '@shared/useVoice'
import { Transcript } from './Transcript'

type Past = { role: 'user' | 'agent'; text: string; at: string; order: { shop: string; shop_id: string; events: Ev[] } | null }
type Ask = { shop: string; shop_id: string; total: number; discount_bps: number; lines: Line[]; wait_s: number; why?: string; says?: string }
type ChatEv =
  | { t: 'thread'; id: string; title: string }
  | { t: 'step'; text: string }
  | { t: 'order'; shop: string; shop_id: string; ev: Ev }
  | { t: 'confirm' } & Ask
  | { t: 'confirmed'; yes: boolean }
  | { t: 'say'; text: string }

/** What the agent is doing right now, before it has answered. */
type Live = { steps: string[]; shop: { name: string; near_id: string } | null; events: Ev[]; ask: Ask | null; answered: boolean | null }
const fresh = (): Live => ({ steps: [], shop: null, events: [], ask: null, answered: null })

const IDEAS = ['What’s my balance?', 'What did I spend recently?', 'Get me 2 adult tickets at the Arboretum', 'Find me lunch under KES 500']

type Thread = { id: string; title: string; at: string; paid: boolean }
const DAY = 24 * 60 * 60 * 1000
const SPEAK_KEY = 'sokoni.speak'

/** One reply at a time, read aloud. Starting another stops the one playing. */
let playing: HTMLAudioElement | null = null
async function say(text: string): Promise<void> {
  playing?.pause()
  const res = await post('/api/voice/speak', { text })
  const url = URL.createObjectURL(await res.blob())
  playing = new Audio(url)
  playing.onended = () => URL.revokeObjectURL(url)
  await playing.play()
}

/**
 * Talk to your own agent. It can look things up and shop for you, and it asks before it pays.
 * This fills the whole column: its own header on top, messages in the middle, the box to type in at the bottom.
 */
export default function Chat({ onPaid }: { onPaid: () => void }) {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [thread, setThread] = useState<string | null>(null) // null is a chat not started yet
  const [listing, setListing] = useState(false)
  const [past, setPast] = useState<Past[]>([])
  const [loading, setLoading] = useState(false)
  const [agent, setAgent] = useState('')
  const [text, setText] = useState('')
  const [live, setLive] = useState<Live | null>(null)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const end = useRef<HTMLDivElement>(null)
  const [voice, setVoice] = useState(false) // the server has a speech service
  const [aloud, setAloud] = useState(() => localStorage.getItem(SPEAK_KEY) === '1')
  const speak = (words: string) => { void say(words).catch(() => {}) }

  // Tap and speak. The recording stops by itself when the person stops talking, and the words are sent as a
  // normal message, so what was heard is on screen.
  const voiceIn = useVoice((heard) => void send(heard), setError)
  const { hearing, level } = voiceIn
  const listen = () => {
    if (busy.current && hearing === 'off') return
    setError('')
    void voiceIn.listen()
  }

  const loadThreads = () => api<{ chats: Thread[]; agent: string; voice?: boolean }>('/api/chats').then((r) => { setThreads(r.chats); setAgent(r.agent); setVoice(!!r.voice); return r.chats })
  const open = (id: string | null) => {
    setListing(false)
    setThread(id)
    setPast([])
    setError('')
    if (!id) return
    setLoading(true)
    api<{ messages: Past[] }>(`/api/chats/${id}`).then((r) => setPast(r.messages)).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }
  // Pick up the latest conversation, unless it has gone quiet for a day: then start clean.
  useEffect(() => {
    loadThreads().then((all) => { if (all[0] && Date.now() - new Date(all[0].at).getTime() < DAY) open(all[0].id) }).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [past.length, live?.steps.length, live?.events.length, live?.ask])

  async function send(words = text) {
    const said = words.trim()
    if (!said || busy.current) return
    busy.current = true
    setText('')
    setError('')
    setPast((p) => [...p, { role: 'user', text: said, at: new Date().toISOString(), order: null }])
    setLive(fresh())
    let id = thread
    try {
      await stream<ChatEv>('/api/chat', { text: said, thread }, (e) => {
        if (e.t === 'thread') { id = e.id; setThread(e.id); return }
        // With voice on, the agent says its answer, and asks its question aloud. Paying still takes a tap.
        if (aloud && voice && e.t === 'say') speak(e.text)
        if (aloud && voice && e.t === 'confirm') speak(`Shall I pay ${e.shop} ${fmt(e.total)}? Tap yes to confirm.`)
        setLive((now) => {
          const l = now ?? fresh()
          if (e.t === 'step') return { ...l, steps: [...l.steps, e.text] }
          if (e.t === 'order') return { ...l, shop: { name: e.shop, near_id: e.shop_id }, events: [...l.events, e.ev] }
          if (e.t === 'confirm') return { ...l, ask: e, answered: null }
          if (e.t === 'say') return l
          if (e.t === 'confirmed') return { ...l, answered: e.yes }
          return l
        })
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
      // The saved turn, with the order's conversation attached.
      if (id) await api<{ messages: Past[] }>(`/api/chats/${id}`).then((r) => setPast(r.messages)).catch(() => {})
      setLive(null)
      void loadThreads().catch(() => {})
      onPaid()
    }
  }
  const reply = (yes: boolean) => {
    setLive((l) => l && { ...l, answered: yes })
    api('/api/chat/confirm', { body: { yes } }).catch((e) => setError(e.message))
  }
  const { ask, sheet } = useConfirm()
  const forget = async (t: Thread) => {
    if (!(await ask({ title: 'Delete this chat?', body: `“${t.title}” is removed. Payments made in it stay in Activity.`, yes: 'Delete', danger: true }))) return
    await api(`/api/chats/${t.id}`, { method: 'DELETE' }).catch((e) => setError(e.message))
    if (t.id === thread) open(null)
    void loadThreads().catch(() => {})
  }

  const title = listing ? 'Your chats' : thread ? threads?.find((t) => t.id === thread)?.title ?? 'Chat' : 'New chat'
  const pill = 'shrink-0 rounded-full bg-fill px-3.5 py-2 text-sm font-medium hover:bg-line disabled:opacity-50'
  return (
    <>
      {sheet}
      <header className="relative z-20 flex items-center gap-2 pb-3 pt-4">
        <button type="button" onClick={() => setListing(!listing)} aria-pressed={listing} disabled={!!live} className={pill}>{listing ? 'Back' : 'Chats'}</button>
        <h1 className="min-w-0 flex-1 truncate text-center text-base font-bold">{title}</h1>
        {voice && (
          <button type="button" aria-pressed={aloud} aria-label={aloud ? 'Stop reading replies aloud' : 'Read replies aloud'} title={aloud ? 'Replies are read aloud' : 'Replies are silent'}
            onClick={() => { const on = !aloud; setAloud(on); localStorage.setItem(SPEAK_KEY, on ? '1' : '0'); if (!on) playing?.pause() }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${aloud ? 'bg-iris text-white' : 'bg-fill hover:bg-line'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z" />{aloud ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5M21 9.5l-5 5" />}
            </svg>
          </button>
        )}
        <button type="button" onClick={() => open(null)} disabled={!!live || (!thread && !listing)} className={pill}>New chat</button>
      </header>

      <div className="scroll -mx-4 flex flex-col gap-3 px-4 pb-4 pt-1">
        {listing ? (
          threads === null ? <div className="skeleton h-16 !rounded-3xl" /> : threads.length === 0 ? (
            <p className="rounded-3xl bg-card p-5 text-sm text-soft">No chats yet. Start one with “New chat”.</p>
          ) : (
            <ul className="space-y-2">
              {threads.map((t) => (
                <li key={t.id} className={`flex items-center gap-2 rounded-3xl bg-card pr-2 ${t.id === thread ? 'ring-2 ring-iris' : ''}`}>
                  <button type="button" onClick={() => open(t.id)} className="min-w-0 flex-1 px-4 py-3.5 text-left">
                    <span className="block truncate font-semibold">{t.title}</span>
                    <span className="block text-xs text-soft">{new Date(t.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{t.paid ? ' · paid for something' : ''}</span>
                  </button>
                  {t.paid && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-good" />}
                  <button type="button" onClick={() => forget(t)} aria-label={`Delete ${t.title}`} className="shrink-0 rounded-full p-2 text-soft hover:bg-bad-wash hover:text-bad">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {loading && <div className="space-y-3"><div className="skeleton h-12 w-2/3" /><div className="skeleton ml-auto h-10 w-1/2" /></div>}
            {!loading && past.length === 0 && !live && (
              <div className="my-auto rounded-3xl bg-card p-5">
                <h2 className="text-lg font-bold">Ask your agent</h2>
                <p className="mt-1 text-sm text-soft">It knows your balance, limits and payments, and it can find a shop and buy for you. It shows you the total and waits for your yes before paying.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {IDEAS.map((i) => <button key={i} type="button" onClick={() => send(i)} className="rounded-full bg-fill px-3.5 py-2 text-left text-sm font-medium hover:bg-line">{i}</button>)}
                </div>
                {agent && <p className="mt-3 text-xs text-soft">Agent: {agent}</p>}
              </div>
            )}

            {past.map((m, n) => (
              <div key={n} className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                {m.order && <Talk shop={{ name: m.order.shop, near_id: m.order.shop_id }} events={m.order.events} running={false} />}
                <p className={`max-w-[88%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 ${m.role === 'user' ? 'rounded-br-md bg-iris text-white' : 'rounded-bl-md bg-card'}`}>{m.text}</p>
                {voice && m.role === 'agent' && (
                  <button type="button" onClick={() => speak(m.text)} className="-mt-1 ml-2 flex items-center gap-1 text-xs font-medium text-soft hover:text-ink">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 5v14l12-7z" /></svg>Listen
                  </button>
                )}
              </div>
            ))}

            {live && (
              <div className="flex flex-col items-start gap-2" aria-live="polite">
                {live.steps.map((s, n) => (
                  <p key={n} className="rise flex items-center gap-2 px-1 text-xs font-medium text-soft">
                    <span className={`h-1.5 w-1.5 rounded-full ${n === live.steps.length - 1 && !live.ask && live.events.length === 0 ? 'bg-iris' : 'bg-line'}`} />{s}
                  </p>
                ))}
                {live.shop && <Talk shop={live.shop} events={live.events} running={!live.ask || live.answered === true} open />}
                {live.ask && live.answered === null && <Confirm ask={live.ask} onReply={reply} />}
                {live.ask && live.answered === false && <p className="px-1 text-xs font-medium text-soft">You said no. Nothing was paid.</p>}
                {!live.shop && <p className="dots rounded-3xl rounded-bl-md bg-card px-4 py-3" aria-label="Your agent is thinking"><i /><i /><i /></p>}
              </div>
            )}
            {error && <Notice>{error}</Notice>}
            <div ref={end} />
          </>
        )}
      </div>

      {/* Pinned to the bottom edge of the column. */}
      {!listing && (
        <form className="flex gap-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
          {voice && (
            <button type="button" onClick={listen} disabled={!!live || hearing === 'working'} aria-pressed={hearing === 'on'} aria-label={hearing === 'on' ? 'Stop and send' : 'Speak to your agent'}
              className={`relative flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-full ring-1 ring-line disabled:opacity-60 ${hearing === 'on' ? 'bg-bad text-white' : 'bg-card hover:bg-fill'}`}>
              {/* Grows with the voice, so the person can see they are being heard. */}
              {hearing === 'on' && <span className="absolute inset-0 rounded-full bg-bad/35 transition-transform duration-75" style={{ transform: `scale(${1 + level * 0.7})` }} aria-hidden />}
              {hearing === 'on'
                ? <span className="relative h-4 w-4 rounded-[4px] bg-white" aria-hidden />
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></svg>}
            </button>
          )}
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={600} disabled={!!live || hearing !== 'off'} placeholder={hearing === 'on' ? 'Listening… stop talking to send' : hearing === 'working' ? 'Working out what you said…' : live ? 'Your agent is working…' : 'Ask, or say what to buy'} aria-label="Message your agent"
            className="min-w-0 flex-1 rounded-full bg-card px-5 py-3.5 outline-none ring-1 ring-line placeholder:text-soft focus:ring-2 focus:ring-iris disabled:opacity-60" />
          <Button disabled={!!live || !text.trim()} aria-label="Send" className="!px-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </Button>
        </form>
      )}
    </>
  )
}

/** The agent-to-agent conversation behind an order. Closed by default once it is over; tap to read it. */
function Talk({ shop, events, running, open = false }: { shop: { name: string; near_id: string }; events: Ev[]; running: boolean; open?: boolean }) {
  const [shown, setShown] = useState(open)
  const paid = events.some((e) => e.t === 'receipt')
  const said = events.filter((e) => e.t === 'msg').length
  // The receipt or ticket is the result, so it stays in view; the talk that led to it can be folded away.
  const talk = events.filter((e) => e.t !== 'receipt')
  const result = events.filter((e) => e.t === 'receipt')
  return (
    <div className="w-full space-y-2">
      <div className="rounded-3xl bg-card">
        <button type="button" onClick={() => setShown(!shown)} aria-expanded={shown} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          <ShopIcon name={shop.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">Your agent and {shop.name}’s agent</span>
            <span className="block text-xs text-soft">{running ? 'Talking now…' : `${said} ${said === 1 ? 'message' : 'messages'}${paid ? ', paid' : ', nothing paid'}`}</span>
          </span>
          <span className="rounded-full bg-fill px-3 py-1.5 text-xs font-semibold">{shown ? 'Hide' : 'Read'}</span>
        </button>
        <div className={`reveal ${shown ? 'open' : ''}`}>
          <div><div className="border-t border-line px-3 py-3"><Transcript events={talk} running={running} shop={shop} /></div></div>
        </div>
      </div>
      {result.length > 0 && <Transcript events={result} running={false} shop={shop} />}
    </div>
  )
}

/** The one moment the agent stops: here is the shop and the total, shall I pay? */
function Confirm({ ask, onReply }: { ask: Ask; onReply: (yes: boolean) => void }) {
  const [left, setLeft] = useState(ask.wait_s)
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="rise w-full rounded-3xl bg-card p-5 ring-2 ring-iris" role="group" aria-label="Confirm this payment">
      <p className="text-sm text-soft">Shall I pay <Link to={`/shop/${ask.shop_id}`} className="font-semibold text-ink underline underline-offset-2">{ask.shop}</Link>?</p>
      {ask.why && <p className="mt-1 text-sm">I chose it because {ask.why.replace(/^because\s+/i, '').replace(/\.$/, '')}.</p>}
      {ask.says && <p className="mt-2 rounded-2xl bg-canvas px-3 py-2 text-sm">{ask.shop} says: {ask.says}</p>}
      <ul className="mt-2 space-y-1 text-sm">
        {ask.lines.map((l) => <li key={l.sku} className="flex justify-between gap-3"><span>{l.qty > 1 ? `${l.qty} × ` : ''}{l.name}</span><span className="num text-soft">{fmt(l.qty * l.unit_price)}</span></li>)}
        {ask.discount_bps > 0 && <li className="flex justify-between gap-3 text-good"><span>Discount agreed</span><span className="num">{ask.discount_bps / 100}% off</span></li>}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-sm text-soft">Total</span>
        <span className="text-right"><span className="num block text-3xl font-extrabold tracking-tight">{fmt(ask.total)}</span><span className="num text-xs text-soft">{usd(ask.total)} sUSD on NEAR</span></span>
      </div>
      <div className="mt-4 flex gap-2">
        <Button tone="quiet" onClick={() => onReply(false)} className="flex-1">Not now</Button>
        <Button onClick={() => onReply(true)} className="flex-1">Yes, pay</Button>
      </div>
      <p className="mt-2 text-center text-xs text-soft">Nothing is paid until you say yes. This offer waits {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.</p>
    </div>
  )
}
