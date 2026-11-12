"use client";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Amount, Meter, TxLink, Verified } from "@/components/ui";
import { SHOP, personaName } from "@/lib/config";
import { fmt } from "@/lib/units";

type Item = { sku: string; name: string; price: number; tags: string[]; stock: number; reorderAt: number; restockQty: number };
type Data = {
  id: string; name: string; place: string; verified: boolean; agentMode: string;
  balance: string;
  limits: { per_payment: string; per_day: string; spent_in_window: string } | null;
  splits: { account_id: string; bps: number; balance: string }[];
  supplier: { id: string; name: string; balance: string } | null;
  presence: { token: string; expiresInMs: number };
  items: Item[];
  rules: { tiers: { min: number; bps: number }[]; groupBps: number };
  sessions: { id: string; customer: string; members: string[]; goal: string; mode: string; status: string; invoiceId?: string; kind?: string; total?: number; createdAt: number }[];
  log: { at: number; kind: string; text: string; hash?: string }[];
};

const STATUS: Record<string, { text: string; cls: string }> = {
  negotiating: { text: "Agents talking", cls: "text-marigold" },
  invoiced: { text: "Waiting for payment", cls: "text-marigold" },
  paid: { text: "Paid", cls: "text-leaf" },
  refused: { text: "Refused by contract", cls: "text-hibiscus" },
  failed: { text: "Not ordered", cls: "text-haze" },
};
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ShopConsole() {
  const [d, setD] = useState<Data | null>(null);
  const [ticket, setTicket] = useState("");
  const [door, setDoor] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetch(`/api/merchant/${SHOP}`).then((r) => r.json()).then((x) => live && !x.error && setD(x)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setDoor(null);
    const r = await fetch("/api/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchant: SHOP, id: ticket.trim() }) }).then((x) => x.json());
    setDoor(r.ok ? { ok: true, text: "Valid ticket. Let them in.", hash: r.hash } : { ok: false, text: `Don't admit: ${r.error}.`, hash: r.hash });
  }

  if (!d) return <main className="p-8 text-haze">Loading the shop…</main>;
  // Only rendered in the browser, after the first load.
  const code = `${window.location.origin}/pay?m=${d.id}&p=${d.presence.token}`;
  const spent = Number(d.limits?.spent_in_window ?? 0);
  const perDay = Number(d.limits?.per_day ?? 0);
  const ownShare = 10_000 - d.splits.reduce((s, x) => s + x.bps, 0);
  const tickets = d.sessions.filter((s) => s.kind === "Ticket" && s.status === "paid");

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-12 pt-5 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-haze underline underline-offset-2">SokoniPay</Link>
          <h1 className="text-4xl font-bold leading-tight">{d.name}</h1>
          <p className="text-sm text-haze">{d.place}</p>
        </div>
        <div className="space-y-1 text-right">
          {d.verified ? <Verified id={d.id} /> : <span className="text-sm text-hibiscus">Not verified</span>}
          <p className="text-xs text-haze">Your agent runs on {d.agentMode}</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr_1fr]">
        {/* Shop code */}
        <section className="space-y-4">
          <div className="overflow-hidden rounded-3xl bg-paper text-ink">
            <div className="pindo h-6" />
            <div className="space-y-3 p-5 text-center">
              <h2 className="text-2xl font-bold">Scan to order</h2>
              <a href={code} target="_blank" rel="noreferrer" aria-label="Open this code as a customer" className="mx-auto block w-fit rounded-xl bg-white p-3">
                <QRCodeSVG value={code} size={208} fgColor="#1b1650" bgColor="#ffffff" level="M" />
              </a>
              <p className="text-sm">
                This code changes every 10 seconds, so an order through it proves the customer is at your stall. No location is collected.
              </p>
              <p className="text-xs opacity-70">No phone to hand? Click the code to open it as a customer.</p>
            </div>
            <div className="pindo h-6" />
          </div>

          <form onSubmit={redeem} className="space-y-2 rounded-3xl bg-cloth p-5">
            <h2 className="text-lg font-bold">Check a ticket at the door</h2>
            <div className="flex gap-2">
              <input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="tkt-…" aria-label="Ticket number" className="min-w-0 flex-1 rounded-xl border border-seam bg-well px-3 py-2 text-sm placeholder:text-haze" />
              <button disabled={!ticket.trim()} className="rounded-xl bg-marigold px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40">Admit</button>
            </div>
            {tickets.length > 0 && (
              <p className="text-xs text-haze">
                Sold today:{" "}
                {tickets.map((t) => (
                  <button key={t.id} type="button" onClick={() => setTicket(t.invoiceId!)} className="mr-2 underline underline-offset-2">{t.invoiceId}</button>
                ))}
              </p>
            )}
            {door && (
              <p role="status" className={`text-sm ${door.ok ? "text-leaf" : "text-hibiscus"}`}>
                {door.text} {door.hash && <TxLink hash={door.hash}>View on NEAR</TxLink>}
              </p>
            )}
          </form>
        </section>

        {/* Orders */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Orders</h2>
          {d.sessions.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-seam p-6 text-sm text-haze">
              No orders yet. When a customer&apos;s agent contacts your agent, the order appears here.
            </p>
          ) : (
            <ul className="space-y-2">
              {d.sessions.map((s) => (
                <li key={s.id} className="rounded-2xl bg-cloth p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{s.members.map(personaName).join(", ")}</span>
                    <span className={`text-sm font-medium ${STATUS[s.status]?.cls}`}>{STATUS[s.status]?.text}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-haze">&ldquo;{s.goal}&rdquo;</p>
                  <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-haze">{time(s.createdAt)}, {s.mode === "table" ? "at the stall" : "pickup"}{s.kind === "Group" ? ", split bill" : ""}</span>
                    {s.total != null && (s.invoiceId && s.status === "paid" ? <Link href={`/r/${s.invoiceId}`} className="underline underline-offset-2"><Amount micro={s.total} className="font-semibold" /></Link> : <Amount micro={s.total} className="font-semibold" />)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 className="pt-2 text-2xl font-bold">Stock</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-haze">
              <tr><th className="pb-2 font-medium">Item</th><th className="pb-2 text-right font-medium">Price</th><th className="pb-2 text-right font-medium">Left</th><th className="pb-2 text-right font-medium">Reorder at</th></tr>
            </thead>
            <tbody className="divide-y divide-seam/50">
              {d.items.filter((i) => i.restockQty > 0).map((i) => (
                <tr key={i.sku}>
                  <td className="py-1.5">{i.name}</td>
                  <td className="num py-1.5 text-right text-haze">{fmt(i.price)}</td>
                  <td className={`num py-1.5 text-right font-semibold ${i.stock <= i.reorderAt ? "text-marigold" : ""}`}>{i.stock}</td>
                  <td className="num py-1.5 text-right text-haze">{i.reorderAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Treasury */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Treasury</h2>
          <div className="rounded-3xl bg-cloth p-5">
            <p className="text-sm text-haze">Operating balance</p>
            <p className="display text-5xl font-bold leading-none"><Amount micro={d.balance} /></p>
            <p className="mt-3 text-sm text-haze">Every sale is split by the contract in the same transaction:</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3"><span>{ownShare / 100}% stays here</span><Amount micro={d.balance} /></li>
              {d.splits.map((s) => (
                <li key={s.account_id} className="flex justify-between gap-3">
                  <span>{s.bps / 100}% to {s.account_id.split(".")[0]}</span>
                  <Amount micro={s.balance} />
                </li>
              ))}
              {d.supplier && (
                <li className="flex justify-between gap-3 border-t border-seam/60 pt-1.5"><span>Paid to {d.supplier.name}</span><Amount micro={d.supplier.balance} /></li>
              )}
            </ul>
          </div>

          <div className="space-y-2 rounded-3xl bg-cloth p-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">Your agent can still spend today</span>
              <span className="num">{d.limits ? fmt(Math.max(0, perDay - spent)) : "…"} of {d.limits ? fmt(perDay) : "…"}</span>
            </div>
            <Meter used={spent} max={perDay} />
            <p className="text-xs text-haze">
              It restocks from the supplier on its own, up to <span className="num">{d.limits ? fmt(d.limits.per_payment) : "…"}</span> sUSD per purchase. It cannot withdraw, change these limits or change the revenue split: only your wallet can.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-lg font-bold">What your agent did</h3>
            {d.log.length === 0 ? (
              <p className="text-sm text-haze">Nothing yet. Sales and restocking decisions are listed here as they happen.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {d.log.map((l, n) => (
                  <li key={n} className="flex gap-3">
                    <span className="num shrink-0 text-haze">{time(l.at)}</span>
                    <span className={l.kind === "refused" ? "text-hibiscus" : l.kind === "restock" ? "text-leaf" : ""}>
                      {l.text} {l.hash && <TxLink hash={l.hash}>View on NEAR</TxLink>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
