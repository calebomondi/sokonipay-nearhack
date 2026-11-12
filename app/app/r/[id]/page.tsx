import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "@/components/Receipt";
import { view } from "@/lib/near";
import { getMerchant, store } from "@/lib/store";

type Invoice = {
  id: string; merchant: string; amount: string; kind: string; status: string;
  contributions: { account_id: string; amount: string }[]; paid_at_ms: number | null; redeemed: boolean;
};

/** A receipt is read straight from the contract, so anyone with the link can check it. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await view<Invoice | null>("get_invoice", { id }).catch(() => null);
  if (!inv) notFound();
  const session = store.sessions.find((s) => s.invoiceId === id);
  const payTx = [...(session?.events ?? [])].reverse().find((e) => e.t === "tx" && e.label.startsWith("Paid"));
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-6">
      <Link href="/pay" className="text-sm text-haze underline underline-offset-2">Back to SokoniPay</Link>
      {inv.status === "Paid" ? (
        <Receipt
          r={{
            id: inv.id,
            merchantName: getMerchant(inv.merchant)?.name ?? inv.merchant,
            merchantId: inv.merchant,
            kind: inv.kind,
            total: Number(inv.amount),
            lines: session?.lines,
            payers: inv.contributions.map((c) => ({ id: c.account_id, amount: Number(c.amount) })),
            paidAt: inv.paid_at_ms ?? undefined,
            txHash: payTx && payTx.t === "tx" ? payTx.hash : undefined,
            redeemed: inv.redeemed,
          }}
        />
      ) : (
        <p className="rounded-2xl border border-seam p-5">
          Invoice {inv.id} is {inv.status === "Open" ? "not paid yet" : "refunded"}, so there is no receipt.
        </p>
      )}
      <p className="text-center text-xs text-haze">Read live from the sokonipay contract on NEAR testnet.</p>
    </main>
  );
}
