# SokoniPay

Your AI agent pays a shop's AI agent in stablecoins on NEAR. It can spend only inside limits you set onchain, and every payment ends in an onchain receipt.

*Sokoni* is Swahili for "at the market". Built for NEAR HACKATHON (Nov 2026). Tracks: `realworld`, `agents`, `swarms`, `security`, `business`.

## The problem

Paying a small merchant means cash, a card terminal with 2-3% fees, or typing a till number and PIN. The merchant still writes the order down, totals it and checks the money arrived. Group orders end with one person paying and chasing everyone else. Handing this to AI agents normally makes it worse, because an agent with your wallet key can spend everything you own.

## What SokoniPay does

- A **Personal Agent** orders for the customer: it checks the shop is verified, agrees a price with the shop's agent and pays the invoice.
- A **Merchant Agent** runs the stall: it quotes inside the owner's discount rules, issues invoices onchain, admits ticket holders and restocks from a supplier.
- Each agent holds a **NEAR function-call access key** that can call only a few methods on the SokoniPay contract. The contract enforces a per-payment and a daily limit. The agent cannot withdraw, raise its limits or redirect revenue.

| Flow | What happens onchain |
|---|---|
| Order | Merchant Agent calls `create_invoice`. Personal Agent calls `pay_invoice`. Revenue is split in the same transaction. |
| Group order | Each friend's agent calls `contribute`. Shares sit in escrow. The shop is paid once, when the invoice is fully funded. If it expires unfunded, `refund_expired` returns every share. |
| Ticket | The paid invoice is the ticket. The merchant calls `redeem`, which works once. |
| Restock | The shop's agent pays a supplier's invoice from its revenue, under the shop's own limits. |
| At the stall | The shop screen shows a QR code that changes every 10 seconds (HMAC over the shop account and a time window). A table order must carry a fresh code. No location is collected. |

## How NEAR is used

| NEAR feature | Role |
|---|---|
| Rust contract `sokonipay.testnet` | Verified-merchant registry, invoices, group escrow, spending limits, revenue splits, receipts, tickets |
| NEP-141 stablecoin | Invoices settle in `susd.sokonipay.testnet`, a demo token for testnet. Mainnet would use native USDC. |
| Function-call access keys | The agent's key lists the methods it may call and cannot attach a deposit. Every method that moves authority or funds out requires 1 yoctoNEAR, which only a full-access key can attach. |
| Named sub-accounts | `mama-mboga.sokonipay.testnet` is readable by a person, and each agent's actions trace to its own account. |
| NEP-297 events | `invoice_created`, `payment`, `revenue_split`, `contribution`, `group_settled`, `refund`, `ticket_redeemed` |
| NEAR AI Cloud | Optional LLM for the agents (OpenAI-compatible API, inference in a TEE). Without a key the agents run on scripted rules. |

## Try it

### A. Contract only, from the terminal (no app, no API key)

Needs Rust, `cargo-near`, `near-cli-rs` and Node.

```sh
cargo test                 # do: run it. see: 33 tests pass (30 contract, 3 token)
```

The contracts are already deployed. To replay every flow against them you need the demo accounts' keys, so use your own parent account:

```sh
near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
cd app && npm install && cd ..
SOKONIPAY_CONTRACT=<you>.testnet ./scripts/01-deploy.sh    # see: both contracts deployed, get_config printed
SOKONIPAY_CONTRACT=<you>.testnet ./scripts/02-demo.sh      # see: steps 1-10 with an explorer link per transaction
```

What to look for in `02-demo.sh`:

| Step | Do | See |
|---|---|---|
| 5 | Alice's agent pays an 8 sUSD invoice | `status: Paid`; shop 5.60, savings 1.60, partner 0.80 |
| 6 | Agent pays 25 sUSD with a 20 limit | `Smart contract panicked: over the per-payment limit` |
| 6 | Agent key calls `set_limits`, then `withdraw` | Both rejected: a function-call key cannot attach the required deposit |
| 7 | Three agents contribute 6 sUSD each | `Open`, `Open`, then `Paid` on the third |
| 8 | Merchant redeems a ticket twice | Second call: `ticket already redeemed` |
| 9 | Shop's agent pays the supplier 9 sUSD | Supplier balance rises by 9 |

### B. The app

```sh
cd app
cp ../.env.example .env.local      # optional: add NEARAI_API_KEY for LLM agents
npm install
NEXT_PUBLIC_SOKONIPAY_CONTRACT=<you>.testnet npm run dev
```

| Do | See |
|---|---|
| Open `http://localhost:3000/pay`, pick Mama Mboga Kitchen, tap "Lunch for me, under 6" | The two agents negotiate, an invoice and a payment link to the explorer, and a receipt prints |
| Tap "Split lunch three ways" | Three agents each pay a share, then one group receipt |
| Tap "Nyama choma for four" | "Payment refused by the contract": 21.60 is over the 20 per-payment limit |
| Tap "Band night ticket", then open `/shop` and admit that ticket twice | First: "Valid ticket". Second: "Don't admit: ticket already redeemed" |
| On `/shop`, click the QR code | A customer tab opens as a table order: "presence code accepted" |
| Watch `/shop` after a few orders | Treasury shows the 70/20/10 split, and "What your agent did" lists a supplier payment when stock runs low |

## Deployed on NEAR testnet

| What | Account |
|---|---|
| SokoniPay contract | [`sokonipay.testnet`](https://testnet.nearblocks.io/address/sokonipay.testnet) |
| Demo stablecoin | [`susd.sokonipay.testnet`](https://testnet.nearblocks.io/address/susd.sokonipay.testnet) |
| Shop / supplier | `mama-mboga.sokonipay.testnet`, `supplier.sokonipay.testnet` |
| Customers | `alice`, `bob`, `carol` under `sokonipay.testnet` |

## Repository layout

| Path | Contents |
|---|---|
| `contract/` | SokoniPay contract (Rust, near-sdk 5) and its unit tests |
| `token/` | Demo NEP-141 stablecoin with an open faucet `mint` |
| `scripts/` | Deploy and end-to-end testnet scripts (near-cli-rs) |
| `app/` | Next.js app: customer view `/pay`, shop console `/shop`, receipts `/r/<invoice>`, agents in `app/lib/agents.ts` |
| `PROJECT.md`, `BUILD.md` | Product notes and build plan |

## Limits of this build

- The app's customers are three demo accounts whose agent keys the server holds. Connecting your own wallet is not built yet.
- Merchants are verified by the contract owner. There is no KYC.
- The contract pays for its own storage, which is fine on testnet and would need storage deposits on mainnet.
- Orders, stock and the agent log are kept by the app server. Balances, invoices, limits and receipts are onchain.

## Disclosures

- All code was written during the hackathon window (from 2026-11-11). There is no earlier code.
- Built with AI assistance (Claude Code).
- Libraries: `near-sdk`, `near-contract-standards`, `near-api-js`, Next.js, React, Tailwind CSS, `qrcode.react`, `jsqr`. NEAR agent skills from `near/agent-skills` are vendored in `.claude/skills/`.

## License

MIT
