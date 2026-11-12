import { agentMode } from "@/lib/llm";
import { view } from "@/lib/near";
import { presenceToken } from "@/lib/presence";
import { getMerchant, store } from "@/lib/store";

export const dynamic = "force-dynamic";

type OnchainMerchant = { name: string; verified: boolean; splits: { account_id: string; bps: number }[] };

/** Everything the merchant console shows: catalog, presence code, live orders, treasury. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getMerchant(id);
  if (!m) return Response.json({ error: "Unknown merchant." }, { status: 404 });
  const bal = (account_id: string) => view<string>("get_balance", { account_id }).catch(() => "0");
  const onchain = await view<OnchainMerchant | null>("get_merchant", { account_id: id });
  const [balance, limits, invoices, supplierBalance, ...shares] = await Promise.all([
    bal(id),
    view("get_limits", { account_id: id }),
    view("get_invoices_for", { account_id: id, limit: 30 }),
    m.supplier ? bal(m.supplier) : Promise.resolve("0"),
    ...(onchain?.splits ?? []).map((s) => bal(s.account_id)),
  ]);
  return Response.json({
    id, name: m.name, blurb: m.blurb, place: m.place, rules: m.rules, items: m.items,
    verified: !!onchain?.verified,
    splits: (onchain?.splits ?? []).map((s, n) => ({ ...s, balance: shares[n] })),
    balance, limits, invoices,
    supplier: m.supplier ? { id: m.supplier, name: getMerchant(m.supplier)?.name, balance: supplierBalance } : null,
    presence: presenceToken(id),
    sessions: store.sessions.filter((s) => s.merchant === id).slice(0, 12)
      .map(({ id, customer, members, goal, mode, status, invoiceId, kind, total, lines, createdAt }) => ({ id, customer, members, goal, mode, status, invoiceId, kind, total, lines, createdAt })),
    log: store.log.filter((l) => l.merchant === id).slice(0, 40),
    agentMode: agentMode(),
  });
}
