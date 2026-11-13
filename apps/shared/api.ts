import { accessToken } from './supabase'

export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8010'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// The merchant console works on one shop at a time. Naming it here sends it with every request.
let shop: string | null = null
export const setShop = (nearId: string | null) => { shop = nearId }

async function headers(json: boolean): Promise<HeadersInit> {
  const token = await accessToken()
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(shop ? { 'X-Shop': shop } : {}) }
}

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => null)
  const detail = body?.detail
  throw new ApiError(res.status, typeof detail === 'string' ? detail : 'That didn’t work. Try again.')
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: await headers(init?.body !== undefined),
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Can’t reach SokoniPay. Check your connection and try again.')
  }
  if (!res.ok) await fail(res)
  return res.json() as Promise<T>
}

/** POST something that isn't JSON (a recording), or fetch something that isn't JSON (audio). Returns the raw response. */
export async function send(path: string, body: FormData | object): Promise<Response> {
  const form = body instanceof FormData
  let res: Response
  try {
    res = await fetch(API + path, { method: 'POST', headers: await headers(!form), body: form ? body : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'Can’t reach SokoniPay. Check your connection and try again.')
  }
  if (!res.ok) await fail(res)
  return res
}

/** POST and read a server-sent event stream, one JSON event at a time. */
export async function stream<E>(path: string, body: unknown, onEvent: (e: E) => void): Promise<void> {
  const res = await fetch(API + path, { method: 'POST', headers: await headers(true), body: JSON.stringify(body ?? {}) })
  if (!res.ok || !res.body) await fail(res)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (line) onEvent(JSON.parse(line.slice(6)) as E)
    }
  }
}

// ---- shapes the API returns (amounts are micro sUSD: 1 sUSD = 1,000,000)

export type Line = { sku: string; name: string; qty: number; unit_price: number }
export type Payer = { id: string; name: string; amount: number }
export type Limits = { per_payment: number; per_day: number; spent_in_window: number; per_payment_kes?: number; per_day_kes?: number }
export type PublicAccount = { near_id: string; name: string; role: string; ready: boolean }
export type Me = { user: { name: string | null; email: string | null }; is_admin: boolean; customer: PublicAccount | null; merchant: PublicAccount | null
  shops: { near_id: string; name: string; ready: boolean; kind: string; status: string }[]
}

export type Ev =
  | { t: 'status'; text: string; ok?: boolean }
  | { t: 'msg'; from: 'personal' | 'merchant'; who: string; kind: string; text: string; lines?: Line[] | null; total?: number | null }
  | { t: 'tx'; who: string; label: string; hash: string }
  | { t: 'invoice'; id: string; total: number; kind: string; lines: Line[] }
  | { t: 'refused'; text: string; reason: string; hash?: string | null }
  | { t: 'collecting'; order_id: string; invoice_id: string; total: number; party_size: number; funded: number; paid: Payer[] }
  | { t: 'receipt'; id: string; total: number; kind: string; lines: Line[] | null; payers: Payer[]; tx_hash?: string | null; ticket?: Ticket | null; pickup_code?: string | null }
  | { t: 'error'; text: string }
  | { t: 'done'; order_id: string; status: string }

/** Entry rights of a ticket. `state` is added by the API; live events carry only the first three. */
export type Ticket = { admits: number; admitted: number; valid_until_ms: number; state?: 'valid' | 'used' | 'expired' }

export type ReceiptData = {
  id: string; shop: string; shop_id: string; kind: string; status?: string; total: number
  lines: Line[] | null; payers: Payer[]; paid_at_ms?: number | null; tx_hash?: string | null; redeemed?: boolean; ticket?: Ticket | null
  /** Set for a counter sale paid ahead: the three digits the customer shows the cashier to collect. */
  pickup_code?: string | null
}
