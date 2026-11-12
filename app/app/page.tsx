import Link from "next/link";
import { Receipt } from "@/components/Receipt";
import { CONTRACT, EXPLORER_ACCOUNT, SHOP } from "@/lib/config";

const TALK = [
  { mine: true, who: "Alice's agent", text: "Lunch for three: 3 × githeri bowl, 3 × chapati, 3 × masala chai. What's your price?" },
  { mine: false, who: "Mama Mboga Kitchen agent", text: "That comes to 11.70 sUSD." },
  { mine: true, who: "Alice's agent", text: "Can you do better for a group order?" },
  { mine: false, who: "Mama Mboga Kitchen agent", text: "I can take 10% off for the group: 10.53 sUSD." },
];

export default function Home() {
  return (
    <main>
      <div className="pindo h-5" aria-hidden />
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-16 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8 lg:pt-16">
        <div>
          <p className="display text-xl font-bold">SokoniPay</p>
          <h1 className="mt-6 text-5xl font-bold leading-[1.02] sm:text-6xl lg:text-7xl">
            Your agent pays the shop&apos;s agent.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-haze">
            Tell your agent what you want. It checks the shop is real, agrees a price with the shop&apos;s agent and pays in
            stablecoins on NEAR. It can only spend inside limits you set, because the contract refuses anything more.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/pay" className="rounded-2xl bg-marigold px-6 py-3.5 text-lg font-semibold text-ink">Order as a customer</Link>
            <Link href="/shop" className="rounded-2xl border border-seam px-6 py-3.5 text-lg font-semibold hover:bg-cloth">Open the shop&apos;s screen</Link>
          </div>
          <p className="mt-4 text-sm text-haze">
            A live demo on NEAR testnet with three customers and one stall. Every payment is a real transaction on{" "}
            <a className="underline underline-offset-2" href={EXPLORER_ACCOUNT + CONTRACT} target="_blank" rel="noreferrer">{CONTRACT}</a>.
          </p>
        </div>

        <div className="mx-auto w-full max-w-sm space-y-3" aria-label="Example: two agents agree an order and the receipt prints">
          {TALK.map((m, n) => (
            <div key={n} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
              <span className="mb-1 px-1 text-xs text-haze">{m.who}</span>
              <p className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${m.mine ? "rounded-br-sm bg-marigold text-ink" : "rounded-bl-sm bg-cloth"}`}>{m.text}</p>
            </div>
          ))}
          <div className="pt-3">
            <Receipt
              animate
              r={{
                id: "grp-example", merchantName: "Mama Mboga Kitchen", merchantId: SHOP, kind: "Group", total: 10_530_000,
                lines: [
                  { name: "Githeri bowl", qty: 3, unitPrice: 2_800_000 },
                  { name: "Chapati", qty: 3, unitPrice: 500_000 },
                  { name: "Masala chai", qty: 3, unitPrice: 600_000 },
                ],
                payers: ["alice", "bob", "carol"].map((p) => ({ id: `${p}.${CONTRACT}`, amount: 3_510_000 })),
                txHash: undefined,
              }}
            />
          </div>
        </div>
      </section>

      <section className="border-t border-seam/60 bg-well">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          {[
            ["The agent can't overspend", "It holds a NEAR key that can only pay invoices. Per-payment and daily limits live in the contract, and only your wallet can change them."],
            ["No fake stickers", "A shop's code points to its NEAR account. Your agent connects only if that account is in the onchain register of verified shops."],
            ["Split a bill in one go", "Each friend's agent pays its share into escrow. The shop is paid once, when the last share lands. If it never does, everyone is refunded."],
            ["The shop runs itself", "Each sale is split between the owner, savings and partners as it settles. When stock runs low, the shop's agent pays the supplier from revenue."],
          ].map(([h, p]) => (
            <div key={h}>
              <h2 className="text-xl font-bold">{h}</h2>
              <p className="mt-2 text-sm text-haze">{p}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
