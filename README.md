# SokoniPay

A customer's AI agent pays a shop's AI agent, in shillings, settled in a dollar stablecoin on NEAR. The customer's spending limits are enforced by a NEAR contract, so the agent can pay but cannot overspend, withdraw or change its own limits.

*Sokoni* is Swahili for "at the market". Built for NEAR HACKATHON, November 2026. Tracks: `realworld`, `agents`, `swarms`, `security`, `business`.

| | |
|---|---|
| User app | https://sokonipay.up.railway.app |
| Merchant console | https://merchant-sokonipay.up.railway.app |
| Contract | [`sokonipay.testnet`](https://testnet.nearblocks.io/address/sokonipay.testnet) on NEAR testnet |
| Demo token | [`susd.sokonipay.testnet`](https://testnet.nearblocks.io/address/susd.sokonipay.testnet) (sUSD, 6 decimals) |

## The problem

At the Nairobi Arboretum gate, each visitor reads a phone number to the cashier and waits for a payment prompt on their phone. If the prompt fails, the cashier can't resend it to the same number straight away, so that person steps aside and often ends up at the back of the line.

Small businesses everywhere have a version of this: a queue at the till, a customer typing a till number and a PIN, an owner checking by hand that the money arrived. Handing the job to AI agents normally makes it riskier, because an agent that holds your wallet key can spend everything you own.

## What SokoniPay does

- The shop has one printed code that only says who the shop is. Customers scan it on their own phones, all at once, and nobody gives out a phone number.
- The customer's **Personal Agent** checks the shop is on the onchain register of verified shops, agrees a price with the shop's **Merchant Agent**, and pays the invoice.
- Each agent holds a **NEAR function-call access key**. It can call a few methods on the SokoniPay contract and cannot attach a deposit. The contract enforces a per-payment and a daily limit on every payment the agent makes.
- Anything that moves authority or takes money out (limits, withdrawals, refunds, revenue splits, subscriptions) needs the owner's full key. The contract tells the two apart by a 1 yoctoNEAR deposit, which an agent key cannot attach.

It is for paying businesses only. A payment can only go to an invoice issued by a verified shop.

## Try it

Sign-in is with Google. Signing in creates a NEAR testnet account that SokoniPay holds for you, with demo money. No wallet or funds are needed.

### As a customer

Open https://sokonipay.up.railway.app.

| Do this | See this |
|---|---|
| Sign in with Google | A balance of about KES 6,500 (50 demo dollars) and the card "Agent spend limit today" |
| Home → "All shops" → "Nairobi Arboretum (demo)" → pick 2 Adult → "Get 2 tickets" | The two agents' conversation, then a green ticket with a ticking clock and a QR code. The balance drops. "See the payment on NEAR" opens the transaction. |
| On the same page pick 20 Adult and buy | A red box: "The contract refused this payment", naming the per-payment limit. Nothing is paid. The refused transaction is linked. |
| Home → "Limits" → lower the per-payment limit → buy again | The contract now refuses a smaller purchase. Only you can change limits; the agent cannot. |
| "Chat" → type `Get me 2 adult tickets at the Arboretum` | The agent finds the shop and agrees a price, then stops at "Shall I pay?". Nothing is paid until you tap "Yes, pay". The agent-to-agent conversation can be opened and read. |
| "Chat" → `What's my balance?` | An answer from your onchain balance and limits. With a microphone, tap the mic and say it instead. |
| Home → "Add money" → pick Base → USDC → 25 | A live quote from NEAR Intents. "Try it with demo money" credits the quoted amount in demo dollars (see "What is simulated"). |
| "Mama Njeri's Kitchen (demo)" → type `2 chapati and a masala chai` | The agents negotiate. If a discount rule fits the order, the shop's agent offers it and names the rule. A receipt follows. |
| On the stall's page choose 2 people and order | Your share goes into escrow in the contract. A link lets a friend pay theirs. The shop is paid once, when the last share arrives. |
| "Activity" | Every payment, refund and top-up, red for money out and green for money in |

### As a merchant

Open https://merchant-sokonipay.up.railway.app.

| Do this | See this |
|---|---|
| Sign in with Google → choose a type → name it → add prices in KES | A live preview of the shop as customers will see it, then "Opening your shop" (about 25 seconds: a NEAR account, the onchain register, an agent key) |
| Look at the console | The shop is "Not verified yet" and has no code. A new shop is hidden from customers until an admin verifies it on the onchain register. This is deliberate: it is what stops a fake sticker. We verify demo shops on request. |

To see a working console without waiting, the two demo shops above show what a verified shop gets: sales charts, the gate (scan a ticket and let people in), refunds, discount rules, subscriptions, the revenue split, withdrawals, the daily statement with CSV export, and the shop's own styled QR code.

## How NEAR is used

| NEAR feature | What it does here |
|---|---|
| Our contract, `contract/` (Rust, near-sdk 5) | The register of verified shops, invoices, escrow for split bills, agent spending limits, revenue splits, tickets, refunds and subscription mandates |
| Function-call access keys | The whole security model. A customer's agent key can call `pay_invoice` and `contribute`. A shop's agent key can call `create_invoice`, `pay_invoice` and `redeem`. Neither can attach a deposit, so neither can call anything that needs 1 yoctoNEAR. |
| NEP-141 token | Invoices are priced and settled in one stablecoin. Testnet uses our demo token; a mainnet deployment would name native USDC when the contract is initialised. |
| Named sub-accounts | Every user and shop is `<name>.sokonipay.testnet`, so each onchain action traces to one account. |
| NEP-297 events | `payment`, `revenue_split`, `refund`, `subscribe`, `withdraw` and others, for an indexer or an accountant |
| NEAR AI Cloud | Inference for both agents and the chat agent (LangGraph, two separate graphs that share no memory, tools or keys) |
| NEAR Intents 1Click API | Live quotes for adding and withdrawing money in any of about 25 chains' stablecoins |

### The contract

| Method | Who can call it | What it does |
|---|---|---|
| `set_limits` | Owner (1 yocto) | Sets the per-payment and daily limit for the caller's agent |
| `create_invoice` | Verified shop, or its agent key | Issues an invoice: single, ticket or group |
| `pay_invoice` | Customer, or their agent key | Pays an invoice. With an agent key the limits apply. |
| `contribute` / `refund_expired` | Customer or agent / anyone | Pays a share of a group invoice into escrow / returns shares if it expires unfunded |
| `redeem` | Shop or its agent key | Lets ticket holders in. Refuses a used-up or expired ticket. |
| `refund` | Shop owner (1 yocto) | Returns a paid invoice in full to whoever paid. A ticket only if nobody has entered on it. |
| `set_revenue_split` | Shop owner (1 yocto) | Divides every sale between the shop and other accounts, in the same transaction |
| `sweep` | Shop owner (1 yocto) | Moves a balance held by the shop's own sub-account (savings) back to the shop |
| `subscribe` / `unsubscribe` | Customer (1 yocto) | Lets one shop bill a fixed amount once per period. The contract refuses a bill that is early, for a different amount, or after unsubscribing. |
| `withdraw` | Owner (1 yocto) | Takes tokens out of the SokoniPay balance |
| `set_verified` | Contract owner | Puts a shop on, or takes it off, the register |

## What is real and what is simulated

Real, and checkable:

- The contract is deployed on NEAR testnet. Every payment, refusal, refund, ticket admission, split and subscription bill is a transaction with an explorer link in the app.
- The limits are enforced by the contract, not by the app. The refusal in "Try it" is the contract panicking.
- The agents run on NEAR AI Cloud. Setting `AGENT_MODE=scripted` runs both on deterministic rules with no model, for reproducibility.
- Add money and Withdraw show live quotes from the NEAR Intents 1Click API.

Simulated, and labelled in the app:

- The dollars are a demo token (sUSD) that anyone can mint on testnet. It has no value.
- NEAR Intents runs on mainnet only. "Add money" credits the quoted amount in demo dollars, and "Withdraw" takes the demo dollars out of the balance, but no real coins move on the other chain. A real-deposit path exists in the code (`INTENTS_TREASURY`) and is switched off.
- Shilling prices are converted at a live KES/USD rate. There is no route to or from M-Pesa or a bank; that needs a licensed partner.

Limits of the hackathon build:

- **Custodial.** Users sign in with Google and the backend holds each account's keys, encrypted. The agent key and the owner key are separate keys with separate powers onchain, but both are held by the server.
- **Shop verification is manual.** An admin approves each shop.
- **One backend instance.** A confirmation waiting for a "yes" and the double-payment lock are held in memory.

## Repository

| Path | What is there |
|---|---|
| `contract/` | The SokoniPay contract and its 52 unit tests |
| `token/` | The demo NEP-141 token |
| `backend/` | FastAPI service: accounts, the two agents (`app/agents/`), orders, chat, subscriptions, NEAR Intents quotes, voice |
| `apps/customer/` | The user app (Vite, React) |
| `apps/merchant/` | The merchant console and the admin page |
| `apps/shared/` | Code both apps use |
| `scripts/` | Deploy the contracts, run everything locally |
| `app/` | The first version (Next.js, no accounts). Kept for reference; not deployed. |
| `PROJECT.md`, `BUILD.md` | What the product is and how it was built |
| `TEST_PROMPT.md` | A step-by-step browser test with expected results |

## Run the tests

```sh
cargo test -p sokonipay          # 52 contract tests
cd backend && uv run pytest      # 7 pricing and discount tests
cd apps && npm ci && npm run build
```

## Run it yourself

The hosted demo is the quick path. Running your own copy needs a NEAR testnet account for the contract, a Supabase project (Postgres, and Google sign-in enabled), and optionally keys for NEAR AI Cloud and ElevenLabs.

Tools: Rust with `cargo-near`, `near-cli-rs`, `uv`, Node 20 or later.

```sh
# 1. Contracts: builds both and deploys them to testnet. Reads the account's key from ~/.near-credentials.
SOKONIPAY_CONTRACT=<your-account>.testnet ./scripts/01-deploy.sh

# 2. Backend settings
cp backend/.env.example backend/.env      # fill in Supabase, ROOT_ACCOUNT_KEY, KEY_VAULT_SECRET, ADMIN_EMAILS

# 3. App settings
cp apps/customer/.env.example apps/customer/.env.local
cp apps/merchant/.env.example apps/merchant/.env.local

# 4. Everything at once: backend on :8010, user app on :5173, console on :5174
(cd apps && npm ci) && ./scripts/dev.sh
```

In Supabase, add `http://localhost:5173/auth/callback` and `http://localhost:5174/auth/callback` to the allowed redirect URLs. The account in `ADMIN_EMAILS` can open `/admin` on the console to verify shops.

Leave `NEAR_AI_CLOUD_API_KEY` empty, or set `AGENT_MODE=scripted`, to run the agents without a model. Leave `ELEVENLABS_API_KEY` empty and the voice buttons do not appear.

## Other project by the same author

The author also built [Thalace Shops](https://github.com/calebomondi/thalace-shops) for this hackathon. The two are separate projects with separate code and contracts:

- **Thalace Shops** is about a business selling online: each shop has an agent and a wallet on NEAR Intents, and sells to people and to other agents.
- **SokoniPay** is about a customer paying a business in person: one code at the gate or till, a customer agent with onchain spending limits, and its own contract for invoices, tickets, refunds and subscriptions.

They are in separate repositories. They use the same Supabase project for sign-in and Postgres, in separate schemas.

## License

MIT. See `LICENSE`.
