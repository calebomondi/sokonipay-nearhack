import { view } from "@/lib/near";
import { getMerchant, store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await view<{ merchant: string } | null>("get_invoice", { id });
  if (!invoice) return Response.json({ error: "No such invoice." }, { status: 404 });
  const session = store.sessions.find((s) => s.invoiceId === id);
  const txs = session?.events.filter((e) => e.t === "tx") ?? [];
  return Response.json({ invoice, merchantName: getMerchant(invoice.merchant)?.name ?? invoice.merchant, lines: session?.lines ?? null, txs });
}
