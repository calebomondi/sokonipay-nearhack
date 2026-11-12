"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Receipt, type ReceiptData } from "@/components/Receipt";
import { Scanner } from "@/components/Scanner";
import { Amount, Meter, TxLink, Verified } from "@/components/ui";
import { PERSONAS, personaName } from "@/lib/config";
import { fmt } from "@/lib/units";

type Shop = { id: string; name: string; blurb: string; place: string; verified: boolean; items: { sku: string; name: string; price: number; tags: string[]; stock: number }[] };
type Limits = { per_payment: string; per_day: string; spent_in_window: string } | null;
type Account = { balance: string; limits: Limits; invoices: { id: string; merchant: string; amount: string; status: string; kind: string; paid_at_ms: number | null }[] };
type Line = { sku: string; name: string; qty: number; unitPrice: number };
type Ev =
  | { t: "status"; text: string; ok?: boolean }
  | { t: "msg"; from: "personal" | "merchant"; who: string; kind: string; text: string; lines?: Line[]; total?: number }
  | { t: "tx"; label: string; hash: string; who: string }
  | { t: "invoice"; id: string; total: number; kind: string; lines: Line[] }
  | { t: "refused"; text: string; reason: string; hash?: string }
  | { t: "receipt"; id: string; total: number; kind: string; payers: { id: string; amount: number }[] }
  | { t: "error"; text: string }
  | { t: "done" };

const IDEAS = [
  { label: "Lunch for me, under 6", goal: "Lunch for me, under 6 sUSD", friends: false },
  { label: "Split lunch three ways", goal: "Lunch for three, vegetarian, under 20 sUSD", friends: true },
  { label: "Band night ticket", goal: "One entry ticket for Friday band night", friends: false },
  { label: "Nyama choma for four", goal: "4 nyama choma", friends: false },
];

export default function Pay() {
  const [me, setMe] = useState<string>(PERSONAS[0].id);
  const [account, setAccount] = useState<Account | null>(null);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [presence, setPresence] = useState<string | undefined>();
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");
  const [goal, setGoal] = useState("");
  const [friends, setFriends] = useState<string[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    () => fetch(`/api/account/${me}`).then((r) => r.json()).then(setAccount).catch(() => {}),
    [me],
  );

  useEffect(() => {
    const saved = localStorage.getItem("sokoni.me");
    if (saved && PERSONAS.some((p) => p.id === saved)) setMe(saved);
  }, []);
  useEffect(() => {
    setAccount(null);
    refresh();
  }, [refresh]);

  // Opening a shop's code: /pay?m=<shop account>&p=<presence code>
  const openCode = useCallback((text: string, list: Shop[]) => {
    let m: string | null = null;
    let p: string | null = null;
    try {
      const u = new URL(text, location.origin);
      m = u.searchParams.get("m");
      p = u.searchParams.get("p");
    } catch {}
    const found = list.find((s) => s.id === (m ?? text));
    if (!found) return setNotice("That code isn't a SokoniPay shop. Check the sticker with the shop before paying.");
    if (!found.verified) return setNotice(`${found.id} is not verified on NEAR. Your agent won't connect to it.`);
    setNotice("");
    setShop(found);
    setPresence(p ?? undefined);
    setEvents([]);
  }, []);

  useEffect(() => {
    fetch("/api/directory").then((r) => r.json()).then((list: Shop[]) => {
      setShops(list);
      const q = new URLSearchParams(location.search);
      if (q.get("m")) openCode(location.href, list);
    }).catch(() => setNotice("The directory didn't load. Check your connection and reload."));
  }, [openCode]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  async function send(text = goal, withFriends = friends) {
    if (!shop || running || text.trim().length < 3) return;
    setRunning(true);
    setEvents([]);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchant: shop.id, customer: me, friends: withFriends, goal: text, mode: presence ? "table" : "pickup", presence }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The order didn't start.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        const batch = parts.filter(Boolean).map((l) => JSON.parse(l) as Ev);
        if (batch.length) setEvents((e) => [...e, ...batch]);
      }
    } catch (e) {
      setEvents((ev) => [...ev, { t: "error", text: String((e as Error).message) }]);
    } finally {
      setRunning(false);
      setPresence(undefined); // a table code works once
      refresh();
    }
  }

  const lim = account?.limits;
  const spent = Number(lim?.spent_in_window ?? 0);
  const perDay = Number(lim?.per_day ?? 0);
  const others = PERSONAS.filter((p) => p.id !== me);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pb-10 pt-4">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="display text-lg font-bold">SokoniPay</Link>
        <label className="flex items-center gap-2 text-sm text-haze">
          Signed in as
          <select
            value={me}
            onChange={(e) => {
              setMe(e.target.value);
              localStorage.setItem("sokoni.me", e.target.value);
              setFriends([]);
              setEvents([]);
            }}
            className="rounded-full border border-seam bg-cloth px-3 py-1.5 font-medium text-chalk"
          >
            {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </header>

      <section className="rounded-3xl bg-cloth p-5" aria-label="Your balance and agent limits">
        <p className="text-sm text-haze">Your balance</p>
        <p className="display mt-1 text-5xl font-bold leading-none">
          {account ? <Amount micro={account.balance} /> : <span className="text-haze">…</span>}
        </p>
        <div className="mt-5 space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span>Your agent can still spend today</span>
            <span className="num font-semibold">{lim ? fmt(Math.max(0, perDay - spent)) : "…"} of {lim ? fmt(perDay) : "…"}</span>
          </div>
          <Meter used={spent} max={perDay} />
          <p className="text-xs text-haze">
            {lim ? <>Up to <span className="num">{fmt(lim.per_payment)}</span> sUSD per payment. </> : null}
            The NEAR contract enforces these limits. Your agent holds a key that can only pay invoices: it cannot withdraw or raise them.
          </p>
        </div>
      </section>

      {notice && <p role="alert" className="rounded-2xl border border-hibiscus/50 bg-hibiscus/10 p-3 text-sm text-hibiscus">{notice}</p>}

      {!shop ? (
        <>
          <button onClick={() => setScanning(true)} className="rounded-2xl bg-marigold px-5 py-4 text-lg font-semibold text-ink">
            Scan a shop&apos;s code
          </button>
          <section>
            <h2 className="mb-2 text-lg font-bold">Or order ahead</h2>
            <ul className="space-y-2">
              {shops?.map((s) => (
                <li key={s.id}>
                  <button onClick={() => openCode(s.id, shops)} className="w-full rounded-2xl border border-seam p-4 text-left hover:bg-cloth">
                    <span className="display block text-lg font-bold">{s.name}</span>
                    <span className="block text-sm text-haze">{s.blurb}. {s.place}</span>
                    <span className="mt-2 block">{s.verified ? <Verified id={s.id} /> : <span className="text-xs text-hibiscus">Not verified</span>}</span>
                  </button>
                </li>
              )) ?? <li className="text-sm text-haze">Loading shops…</li>}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-bold">Receipts</h2>
            {account?.invoices.filter((i) => i.status === "Paid").length ? (
              <ul className="divide-y divide-seam/60 rounded-2xl border border-seam">
                {account.invoices.filter((i) => i.status === "Paid").slice(0, 8).map((i) => (
                  <li key={i.id}>
                    <Link href={`/r/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-cloth">
                      <span>
                        <span className="block font-medium">{i.kind === "Ticket" ? "Entry ticket" : i.kind === "Group" ? "Group order" : "Order"}</span>
                        <span className="text-xs text-haze">{i.paid_at_ms ? new Date(i.paid_at_ms).toLocaleString() : ""}</span>
                      </span>
                      <Amount micro={i.amount} className="font-semibold" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-haze">Nothing paid yet. Pick a shop and tell your agent what you want.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="space-y-2">
            <button onClick={() => { setShop(null); setEvents([]); setPresence(undefined); }} className="text-sm text-haze underline underline-offset-2">All shops</button>
            <h1 className="text-3xl font-bold leading-tight">{shop.name}</h1>
            <Verified id={shop.id} />
            <p className="text-sm text-haze">
              {presence ? "You scanned the code at the shop, so this is a table order." : "Ordering ahead for pickup. Your agent talks to the shop for you."}
            </p>
            <details className="rounded-2xl border border-seam px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">Menu</summary>
              <ul className="mt-2 space-y-1">
                {shop.items.map((i) => (
                  <li key={i.sku} className="flex justify-between gap-3">
                    <span className={i.stock ? "" : "text-haze line-through"}>{i.name}</span>
                    <span className="num text-haze">{fmt(i.price)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          {events.length > 0 && <Transcript events={events} running={running} shop={shop} me={me} />}
          <div ref={end} />

          {!running && (
            <form
              className="space-y-3 rounded-3xl bg-cloth p-4"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <label htmlFor="goal" className="block font-semibold">{events.length ? "Order something else" : "Tell your agent what you want"}</label>
              <textarea
                id="goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="Lunch for me, under 6 sUSD"
                className="w-full resize-none rounded-xl border border-seam bg-well px-3 py-2.5 placeholder:text-haze"
              />
              <fieldset>
                <legend className="mb-1.5 text-sm text-haze">Split the bill with</legend>
                <div className="flex flex-wrap gap-2">
                  {others.map((p) => {
                    const on = friends.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFriends(on ? friends.filter((f) => f !== p.id) : [...friends, p.id])}
                        className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${on ? "border-marigold bg-marigold text-ink" : "border-seam"}`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <button disabled={goal.trim().length < 3} className="w-full rounded-xl bg-marigold px-5 py-3 font-semibold text-ink disabled:opacity-40">
                Send my agent
              </button>
              <div>
                <p className="mb-1.5 text-sm text-haze">Try one</p>
                <div className="flex flex-wrap gap-2">
                  {IDEAS.map((i) => (
                    <button
                      key={i.label}
                      type="button"
                      onClick={() => {
                        const f = i.friends ? others.map((o) => o.id) : [];
                        setGoal(i.goal);
                        setFriends(f);
                        send(i.goal, f);
                      }}
                      className="rounded-full border border-seam px-3 py-1.5 text-sm hover:bg-well"
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          )}
        </>
      )}

      {scanning && shops && (
        <Scanner
          onClose={() => setScanning(false)}
          onCode={(text) => {
            setScanning(false);
            openCode(text, shops);
          }}
        />
      )}
    </main>
  );
}

function Transcript({ events, running, shop, me }: { events: Ev[]; running: boolean; shop: Shop; me: string }) {
  const payTx = [...events].reverse().find((e) => e.t === "tx" && e.label.startsWith("Paid")) as Extract<Ev, { t: "tx" }> | undefined;
  const invoice = events.find((e) => e.t === "invoice") as Extract<Ev, { t: "invoice" }> | undefined;
  return (
    <section aria-live="polite" className="space-y-3">
      {events.map((e, n) => {
        switch (e.t) {
          case "status":
            return <p key={n} className="arrive text-center text-xs text-leaf">{e.text}</p>;
          case "msg": {
            const mine = e.from === "personal";
            return (
              <div key={n} className={`arrive flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <span className="mb-1 px-1 text-xs text-haze">{e.who}</span>
                <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? "rounded-br-sm bg-marigold text-ink" : "rounded-bl-sm bg-cloth"}`}>{e.text}</p>
              </div>
            );
          }
          case "tx":
            return (
              <p key={n} className="arrive text-center text-xs text-haze">
                {e.who}: {e.label}. <TxLink hash={e.hash}>View on NEAR</TxLink>
              </p>
            );
          case "refused":
            return (
              <div key={n} role="alert" className="arrive rounded-2xl border-2 border-hibiscus p-4">
                <p className="display text-xl font-bold text-hibiscus">Payment refused by the contract</p>
                <p className="mt-1 text-sm">{e.text}</p>
                <p className="mt-2 text-sm text-haze">
                  Your agent can&apos;t go past the limits you set. Order less, or pay this one yourself from your wallet.{" "}
                  {e.hash && <TxLink hash={e.hash}>See the refused transaction</TxLink>}
                </p>
              </div>
            );
          case "receipt": {
            const r: ReceiptData = {
              id: e.id, merchantName: shop.name, merchantId: shop.id, kind: e.kind, total: e.total,
              lines: invoice?.lines, payers: e.payers, txHash: payTx?.hash,
            };
            return (
              <div key={n} className="pt-2">
                <Receipt r={r} animate />
                {e.payers.length > 1 && (
                  <p className="mt-3 text-center text-sm text-haze">
                    Your share: <span className="num font-semibold text-chalk">{fmt(e.payers.find((p) => p.id === me)?.amount ?? 0)} sUSD</span>, the same as {e.payers.filter((p) => p.id !== me).map((p) => personaName(p.id)).join(" and ")}.
                  </p>
                )}
              </div>
            );
          }
          case "error":
            return <p key={n} role="alert" className="arrive rounded-2xl border border-hibiscus/50 bg-hibiscus/10 p-3 text-sm text-hibiscus">{e.text}</p>;
          default:
            return null;
        }
      })}
      {running && (
        <p className="thinking text-center text-sm text-haze" aria-label="Agents are working">
          <span>●</span> <span>●</span> <span>●</span>
        </p>
      )}
    </section>
  );
}
