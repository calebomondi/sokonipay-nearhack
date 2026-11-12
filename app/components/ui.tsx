import { EXPLORER_TX } from "@/lib/config";
import { fmt } from "@/lib/units";

export function Amount({ micro, className = "" }: { micro: number | string; className?: string }) {
  return (
    <span className={`num ${className}`}>
      {fmt(micro)} <span className="text-[0.6em] font-medium opacity-70">sUSD</span>
    </span>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: React.ReactNode }) {
  return (
    <a href={EXPLORER_TX + hash} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {children ?? `${hash.slice(0, 6)}…${hash.slice(-4)}`}
    </a>
  );
}

export function Verified({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf/15 px-2.5 py-1 text-xs font-medium text-leaf">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 6.5 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Verified on NEAR: {id}
    </span>
  );
}

/** How much of a limit is used. */
export function Meter({ used, max, tone = "marigold" }: { used: number; max: number; tone?: "marigold" | "leaf" }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-well" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone === "leaf" ? "bg-leaf" : "bg-marigold"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
