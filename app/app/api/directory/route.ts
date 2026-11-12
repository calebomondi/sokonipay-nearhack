import { view } from "@/lib/near";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const shops = Object.values(store.merchants).filter((m) => m.items.length);
  const out = await Promise.all(
    shops.map(async (m) => ({
      id: m.id, name: m.name, blurb: m.blurb, place: m.place,
      verified: await view<boolean>("is_verified", { account_id: m.id }).catch(() => false),
      items: m.items.map(({ sku, name, price, tags, stock }) => ({ sku, name, price, tags, stock })),
    })),
  );
  return Response.json(out);
}
