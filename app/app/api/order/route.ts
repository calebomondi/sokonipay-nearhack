import { runOrder, type OrderInput } from "@/lib/agents";
import { PERSONAS } from "@/lib/config";
import { getMerchant } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Runs one agent-to-agent order and streams every step as newline-delimited JSON. */
export async function POST(req: Request) {
  const body = (await req.json()) as OrderInput;
  const known = (id: string) => PERSONAS.some((p) => p.id === id);
  if (!known(body.customer) || !(body.friends ?? []).every(known)) {
    return Response.json({ error: "Unknown customer account." }, { status: 400 });
  }
  if (!getMerchant(body.merchant)) return Response.json({ error: "Unknown merchant." }, { status: 404 });
  const goal = String(body.goal ?? "").slice(0, 300).trim();
  if (goal.length < 3) return Response.json({ error: "Tell your agent what you want." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away; the order still completes */
        }
      };
      await runOrder({ ...body, goal, mode: body.mode === "table" ? "table" : "pickup" }, send);
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
