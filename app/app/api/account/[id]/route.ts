import { PERSONAS } from "@/lib/config";
import { view } from "@/lib/near";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PERSONAS.some((p) => p.id === id)) return Response.json({ error: "Unknown account." }, { status: 404 });
  const [balance, limits, invoices] = await Promise.all([
    view<string>("get_balance", { account_id: id }),
    view("get_limits", { account_id: id }),
    view("get_invoices_for", { account_id: id, limit: 20 }),
  ]);
  return Response.json({ id, balance, limits, invoices });
}
