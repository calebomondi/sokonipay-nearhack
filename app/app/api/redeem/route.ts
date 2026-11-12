import { ContractError, agentCall } from "@/lib/near";
import { addLog, getMerchant } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The Merchant Agent admits a ticket holder. The contract allows it once. */
export async function POST(req: Request) {
  const { merchant, id } = await req.json();
  if (!getMerchant(merchant)) return Response.json({ error: "Unknown merchant." }, { status: 404 });
  try {
    const r = await agentCall(merchant, "redeem", { id: String(id) });
    addLog({ merchant, kind: "info", text: `Ticket ${id} redeemed at the door`, hash: r.hash });
    return Response.json({ ok: true, hash: r.hash });
  } catch (e) {
    const reason = e instanceof ContractError ? e.message : "The ticket could not be checked.";
    return Response.json({ ok: false, error: reason, hash: e instanceof ContractError ? e.txHash : undefined }, { status: 409 });
  }
}
