import { EXPLORER_TX, personaName } from "@/lib/config";
import { fmt } from "@/lib/units";

export type ReceiptData = {
  id: string;
  merchantName: string;
  merchantId: string;
  kind: string;
  total: number;
  lines?: { name: string; qty: number; unitPrice: number }[] | null;
  payers: { id: string; amount: number }[];
  paidAt?: number;
  txHash?: string;
  redeemed?: boolean;
};

const WHAT: Record<string, string> = { Single: "Order", Group: "Group order", Ticket: "Entry ticket" };

export function Receipt({ r, animate = false }: { r: ReceiptData; animate?: boolean }) {
  const listed = r.lines?.reduce((s, l) => s + l.qty * l.unitPrice, 0) ?? r.total;
  const discount = listed - r.total;
  return (
    <article className={`receipt mx-auto w-full max-w-sm px-5 pt-5 text-sm ${animate ? "print" : ""}`}>
      <header className="text-center">
        <p className="display text-xl font-bold leading-tight">{r.merchantName}</p>
        <p className="text-xs opacity-70">{r.merchantId}</p>
        <p className="mt-2 inline-block rounded-full border border-ink/30 px-2 py-0.5 text-xs font-medium">
          {WHAT[r.kind] ?? r.kind} paid{r.kind === "Ticket" ? (r.redeemed ? ", already used" : ", valid for one entry") : ""}
        </p>
      </header>

      {r.lines?.length ? (
        <ul className="rule mt-4 space-y-1 pt-3">
          {r.lines.map((l) => (
            <li key={l.name} className="flex justify-between gap-3">
              <span>{l.qty} × {l.name}</span>
              <span className="num">{fmt(l.qty * l.unitPrice)}</span>
            </li>
          ))}
          {discount > 0 && (
            <li className="flex justify-between gap-3 font-medium">
              <span>Agreed by your agent</span>
              <span className="num">−{fmt(discount)}</span>
            </li>
          )}
        </ul>
      ) : null}

      <div className="rule mt-3 flex items-baseline justify-between pt-3">
        <span className="font-medium">Total paid</span>
        <span className="display num text-3xl font-bold">{fmt(r.total)} <span className="text-sm font-medium">sUSD</span></span>
      </div>

      {r.payers.length > 1 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {r.payers.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{personaName(p.id)}&apos;s agent</span>
              <span className="num">{fmt(p.amount)}</span>
            </li>
          ))}
          <li className="pt-1 opacity-70">The shop was paid once, when the last share arrived.</li>
        </ul>
      )}

      <dl className="rule mt-3 space-y-0.5 pt-3 text-xs">
        <div className="flex justify-between gap-3"><dt className="opacity-70">Invoice</dt><dd className="num">{r.id}</dd></div>
        {r.payers.length === 1 && (
          <div className="flex justify-between gap-3"><dt className="opacity-70">Paid by</dt><dd>{r.payers[0].id}</dd></div>
        )}
        {r.paidAt && (
          <div className="flex justify-between gap-3"><dt className="opacity-70">Settled</dt><dd>{new Date(r.paidAt).toLocaleString()}</dd></div>
        )}
      </dl>
      <p className="mt-3 text-center text-xs">
        {r.txHash ? (
          <a className="font-medium underline underline-offset-2" href={EXPLORER_TX + r.txHash} target="_blank" rel="noreferrer">See the payment on NEAR</a>
        ) : (
          <a className="font-medium underline underline-offset-2" href={`/r/${r.id}`}>Open this receipt</a>
        )}
      </p>
    </article>
  );
}
