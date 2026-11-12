# SokoniPay: Build Plan

Deadline: **2026-11-14 23:59 UTC**. Plan to have everything finished by **Nov 14 18:00 UTC**, leaving 6 hours of buffer for the repo, the video, the X post and the submission. See PROJECT.md for the product.

## Decisions

- [x] Contract in **Rust (`near-sdk`)**, with the full demo on **testnet**
- [x] **Solo** builder, so only one workstream runs at a time and the schedule is sequential
- [x] Testnet integration tests and deploys use **near-cli-rs** (installed: v0.30.1). Logic is covered by unit tests with `cargo test`.
- [x] Tracks: `realworld`, `agents`, `swarms`, `security`, `business`
- [x] Customer app: a **mobile-first web app (PWA)**, not React Native (see "Why not React Native" below)
- [x] UI built with the `frontend-design` skill, styled as a polished DeFi app
- [x] NEAR agent skills installed in `.claude/skills/` (`npx skills add near/agent-skills`). Wallet connection follows the `near-dapp` skill: `@hot-labs/near-connect` + `near-connect-hooks` + `near-api-js`. LLM calls follow `near-ai-cloud`: OpenAI-compatible API at `https://cloud-api.near.ai/v1`.
- [ ] Hosting for the demo. **Recommended: Railway or Vercel**, kept up until at least Nov 18 and ideally Nov 25.
- [x] Testnet parent account **`sokonipay.testnet`** created Nov 11 with near-cli-rs (keys in `~/.near-credentials`, outside the repo)
- [ ] A NEAR AI API key (cloud.near.ai, or the free $10 from nearbuilders.org/dashboard), stored in `.env`, **never committed**

Toolchain check (Nov 11):
- Installed: Rust (cargo 1.95), `wasm32-unknown-unknown`, Node 24, near-cli-rs 0.30.1.
- Missing: **`cargo-near`**. Install it on Day 0 with `cargo install --locked cargo-near`, after confirming the current install method in the docs.

## Why not React Native (for this deadline)

- **Solo with 3.5 days.** Two codebases (RN plus a merchant web app) roughly doubles the UI work. One Next.js app can serve both the customer view (mobile-first) and the merchant view (desktop).
- **Judges have to be able to open it.** A URL works on any phone or laptop. An RN app needs an APK, TestFlight or Expo Go, and HACKATHON.md Q-012 values a demo judges can open.
- **Wallet connection.** The NEAR wallet selector and wallet redirects are made for the web. In RN they need deep-link plumbing that would eat a day.
- **No feature lost.** A PWA can be installed to the home screen, scan QR codes with the camera (`getUserMedia`) and keep the agent key in local storage. A demo video shot on a phone looks the same.
- **After the hackathon:** if the business continues, port the customer app to Expo/RN, reusing the TS agent and contract-client code from `packages/`.

## Plan v2 (decided Nov 11, evening)

The first version (one Next.js app, agents inside its server, three demo customers) works on testnet and stays in `app/` as the fallback until v2 passes the same flows. V2 changes the shape, not the contract.

### Decisions
- [x] **Dedicated backend:** Python, FastAPI, managed with `uv`
- [x] **Agents:** LangChain / LangGraph. The Personal Agent and the Merchant Agent are two separate graphs with separate prompts, tools and NEAR keys. They share no state and talk only through A2A messages.
- [x] **Login:** Google through Supabase Auth, using the same Supabase project as `thalace-shops`
- [x] **Custodial accounts** for the hackathon: the backend creates and holds each user's NEAR account
- [x] **Two web apps:** a customer app and a merchant console (Vite + React + TypeScript)
- [x] **Look:** simple, clean and finance-like, inspired by Revolut

### Shape

```
apps/customer  (phone-first)        apps/merchant  (desktop console)
        │  Supabase Google login            │
        └──────────── REST + SSE ───────────┘
                         ▼
backend/  FastAPI
  api/        auth, me, shops, orders (SSE stream), console, receipts
  agents/
    personal/   LangGraph ReAct graph, tools, prompt   ← user's function-call key only
    merchant/   LangGraph ReAct graph, tools, prompt   ← shop's function-call key only
    a2a.py      the only channel between the two agents
    policy.py   rules both modes share: discount clamp, invoice check, basket trim
  near/       py-near client, key vault (Fernet), account provisioning
  services/   orders, treasury (restock), presence codes
  db/         SQLAlchemy + Alembic, Postgres schema `sokonipay`
                         ▼
NEAR testnet: sokonipay.testnet, susd.sokonipay.testnet (unchanged)
NEAR AI Cloud: LLM for both agents (OpenAI-compatible)
```

### Where the agents live
On the backend, never in the browser. Each order starts one run of the Personal Agent graph. Its `message_shop` tool sends an A2A message to the Merchant Agent graph, which runs separately and replies. Every step is streamed to both apps over SSE.

| Agent | Tools | Key it can use |
|---|---|---|
| Personal | `check_shop_verified`, `read_menu`, `message_shop`, `read_invoice`, `pay_invoice`, `pay_share`, `read_my_limits` | The user's function-call key: `pay_invoice`, `contribute` |
| Merchant | `read_catalog`, `make_quote`, `issue_invoice`, `redeem_ticket`, `check_stock`, `ask_supplier`, `pay_supplier` | The shop's function-call key: `create_invoice`, `pay_invoice`, `redeem` |

Guard rails are in code and in the contract, never in the model:
- `make_quote` prices from the catalog and clamps the discount to the owner's rules.
- `pay_invoice` refuses unless the onchain invoice matches the accepted quote.
- The contract enforces per-payment and daily limits.
- The model never sees a key.
- `AGENT_MODE=scripted` runs the same tools from fixed rules, with no LLM, so judges can reproduce the flow without an API key.

LLM: NEAR AI Cloud at `https://cloud-api.near.ai/v1`, key `NEAR_AI_CLOUD_API_KEY`. Models that `thalace-shops` found to call tools on 2026-11-09: `z-ai/glm-5.3`, `Qwen/Qwen3.8-27B`, `deepseek/deepseek-v4.1-flash`. Re-check before relying on them.

### Login and accounts
1. The user signs in with Google (Supabase, PKCE, a callback page; same pattern as `thalace-shops`).
2. The backend checks the token with Supabase and looks the user up.
3. First time, as a customer, the backend:
   - creates `<name>-<4 hex>.sokonipay.testnet` with a little NEAR for gas,
   - mints 50 demo sUSD and deposits it,
   - sets limits of 20 per payment and 40 per day,
   - adds the agent's function-call key.
4. First time, as a merchant, the backend creates `<shop>.sokonipay.testnet`, registers it, verifies it (demo only) and adds the Merchant Agent's key.

This is custodial. The backend stores each account's full-access key encrypted (Fernet) and uses it only for actions the person takes themselves: changing limits, changing the revenue split, withdrawing. The agents can load only the function-call keys. The README must say this plainly.

### Data
Postgres (Supabase) replaces the JSON file. Tables live in their own schema, `sokonipay`, because the Supabase project is shared with `thalace-shops`.

| Table | Holds |
|---|---|
| `accounts` | Supabase user id, role, NEAR account id, encrypted full key, encrypted agent key |
| `shops` | owner, name, place, pricing rules, supplier |
| `items` | shop, name, price, tags, stock, reorder point, restock quantity, unit cost |
| `orders` | shop, customer, friends, request, mode, status, invoice id, total, lines |
| `order_events` | the streamed steps of an order (messages, transactions, receipt) |
| `agent_log` | what the Merchant Agent did: sales, restocks, refusals |

Balances, limits, invoices and receipts are never stored here. They are read from the contract.

### Look
Simple, clean, finance-like:
- **Canvas:** cool off-white with pure white cards; near-black text.
- **One accent:** iris blue-violet for actions. Green only for "paid" and "verified", red only for refusals.
- **Type:** one geometric sans (Onest), large bold balances, tabular figures.
- **Shapes:** generous radius, pill buttons, hairline dividers, no decoration.
- **Customer app:** a balance card, a spend-limit bar, one primary action, a transaction list.
- **Merchant console:** the same system, denser: tables, a treasury panel, the shop code.
- **Receipt:** a plain white slip, kept as the one distinctive element.

### Environment
- Already set: `NEAR_AI_CLOUD_API_KEY`, `SUPABASE_BASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `NEAR_INTENTS_1CLICK_JWT`, `NEAR_INTENTS_AGENT_API_KEY`.
- To add: `KEY_VAULT_SECRET` (Fernet), `PRESENCE_QR_SECRET`, `ROOT_ACCOUNT_KEY` (creates sub-accounts and verifies shops), `ALLOWED_ORIGINS`.
- **You:** add the redirect URLs for both apps (local and hosted) in the Supabase dashboard.

### Two projects in one hackathon
`thalace-shops` is also a NEAR HACKATHON project. Rule Q-015 allows one person two projects only if they are independent and each README names the other. Both READMEs need that line, and SokoniPay must not reuse `thalace-shops` code beyond the login pattern, which the README will disclose.

## Architecture of v1 (built Nov 11, kept in `app/` as the fallback)

```
┌──────────────── Customer phone (PWA) ───────────────┐      ┌──────── Merchant (web console) ────────┐
│ QR scan / directory → verify merchant (view call)   │      │ Catalog + pricing rules editor         │
│ Personal Agent UI: goal, budget, live transcript    │      │ Rotating presence QR (HMAC, 10 s)      │
│ Wallet connect (full key): deposit, set limits,     │      │ Orders / invoices / receipts list      │
│   add agent function-call key                       │      │ Ticket scanner → redeem                │
└───────────────┬─────────────────────────────────────┘      └────────────────┬───────────────────────┘
                │ A2A JSON over HTTP                                          │
                ▼                                                             ▼
        ┌──────────────── Next.js server (API routes) ────────────────────────────────┐
        │ /api/merchant/:id/a2a   Merchant Agent (LLM or scripted) → create_invoice     │
        │ /api/personal/agent     Personal Agent reasoning (LLM proxy, key server-side) │
        │ NEAR AI Cloud (OpenAI-compatible)                                            │
        └───────────────┬──────────────────────────────────────────────────────────────┘
                        ▼
        ┌──────── NEAR testnet ─────────────────────────────────────┐
        │ sokonipay.testnet     main contract                       │
        │ susd.sokonipay.testnet  demo NEP-141 stablecoin           │
        │ <merchant>.sokonipay.testnet  merchant accounts           │
        └───────────────────────────────────────────────────────────┘
```

Key custody:
- **Merchant Agent key:** a function-call key for `create_invoice` / `redeem`, held server-side in an environment variable.
- **Personal Agent key:** a function-call key for `pay_invoice` / `contribute`. It is generated in the browser, stays in the browser, and is added to the user's account with their wallet.
- The LLM only proposes actions. Code checks every action against the agreed quote before any key is used.

## Contract: `sokonipay`

State:
- `merchants: LookupMap<AccountId, Merchant { name, verified: bool, presence_required: bool, splits: Vec<(AccountId, bps)> }>`. The splits must sum to 10000 bps, and an empty list means 100% to the merchant.
- `balances: LookupMap<AccountId, u128>`: user stablecoin deposits
- `limits: LookupMap<AccountId, Limits { per_payment, per_day, spent_today, day_start }>`
- `invoices: LookupMap<InvoiceId, Invoice { merchant, amount, items_hash, kind: Single|Group|Ticket, payer: Option, funded, contributions, status: Open|Paid|Expired|Refunded, expires_at }>`
- `receipts: LookupMap<InvoiceId, Receipt { payers, amount, paid_at, redeemed: bool }>`

Methods:

| Method | Caller | Notes |
|---|---|---|
| `ft_on_transfer(sender, amount, msg)` | stablecoin contract | `msg = "deposit"` credits `balances[sender]`. Reject any other token. |
| `register_merchant(name)` / `verify_merchant(id)` | merchant / admin | `verify_merchant` is owner-only |
| `set_limits(per_payment, per_day)` | user | Requires 1 yocto, so a function-call key can't change limits |
| `withdraw(amount)` | user | Requires 1 yocto |
| `set_revenue_split(splits)` | merchant owner | Requires 1 yocto, so the agent key can't redirect revenue |
| `create_invoice(id, amount, items_hash, kind, payer?, expires_in)` | verified merchant (agent key OK) | Single invoices may pin a payer |
| `pay_invoice(id)` | user **or merchant** (agent key OK) | Check limits → debit → credit the merchant **according to its revenue split** → receipt → event. Merchants use this same method to pay supplier invoices, which is the procurement path. |
| `contribute(id, amount)` | user (agent key OK) | Check limits → escrow. Once fully funded, settle to the merchant (applying its split) in one step. |
| `refund_expired(id)` | anyone | Return group contributions after expiry |
| `redeem(id)` | merchant | Marks a ticket receipt as used |
| `withdraw_merchant(amount)` | merchant | `ft_transfer` out of the contract |
| views | anyone | `get_merchant`, `is_verified`, `get_invoice`, `get_receipt`, `get_balance`, `get_limits` |

Events (NEP-297, `standard: "sokonipay"`): `invoice_created`, `payment`, `revenue_split`, `contribution`, `group_settled`, `refund`, `ticket_redeemed`.

Every account (customer or merchant) holds an internal stablecoin balance. Merchant revenue lands in those balances, so a merchant's operating balance can pay a supplier with no withdraw/deposit round trip.

Demo token: a minimal NEP-141 (`susd`, 6 decimals) with an open `mint` for testnet only. Document that mainnet would use native USDC, and check its contract address at docs.near.org before relying on it.

Tests:
- **Unit tests** (`cargo test`, using near-sdk `VMContextBuilder`), covering contract logic:
  - pay is rejected over the per-payment limit and over the daily limit
  - pay succeeds within the limit and creates a receipt
  - an unverified merchant can't invoice
  - the revenue split adds up exactly, with no rounding dust lost (the remainder goes to the first split)
  - group: 3 contributions settle exactly once
  - expiry refunds everyone
  - a ticket can't be redeemed twice
  - a merchant pays a supplier from revenue
- **Testnet integration** (`scripts/*.sh` using near-cli-rs), covering what unit tests can't:
  - deploy + init
  - `ft_transfer_call` deposit across contracts
  - add a function-call key → an agent-key `pay_invoice` succeeds
  - an agent key calling `withdraw` / `set_limits` / `set_revenue_split` **fails**, because those require 1 yocto
  - every script prints explorer links, which go straight into the README

## Agents

The agents exchange this A2A message schema (JSON):

```
request_quote  { from, goal, budget, items? }
quote          { quote_id, lines[{sku, qty, unit_price}], total, valid_until, rationale }
counter        { quote_id, changes, reason }
accept         { quote_id, presence_token? }
invoice        { invoice_id, tx_hash }
paid           { invoice_id, tx_hash }
```

- **Merchant Agent:** has a system prompt plus the catalog and pricing rules (maximum discount, minimum order, bundles). Its tools are `get_catalog`, `make_quote`, `issue_invoice`. Code enforces the rules: an LLM quote that breaks them is clamped.
  - **Treasury loop:** stock decrements on each paid order. When an item falls below its reorder point, the agent sends `request_quote` to the supplier's Merchant Agent (the same A2A code), checks the quote against a max unit cost, and pays with `pay_invoice` from its balance under its onchain limits. Every decision is written to a log shown in the console.
- **Personal Agent:** has the user's goal and budget. Its tools are `browse_catalog`, `request_quote`, `counter`, `accept`, `pay`. Code checks before paying that `invoice.amount == accepted quote total` and that the total is within the user's limits.
- **Scripted mode** (`AGENT_MODE=scripted`): rule-based agents with no LLM, so the README demo runs without an API key.
- **LLM:** NEAR AI Cloud through its OpenAI-compatible API. Check the base URL and model names at docs.near.ai on Day 1.

## Frontend (Next.js + Tailwind, PWA)

Customer:
- onboarding (connect wallet, mint demo sUSD, deposit, set limits, authorise agent key)
- scan QR / directory
- chat-style agent transcript
- invoice card
- receipts / tickets list

Merchant:
- catalog editor (with stock levels and reorder points)
- presence QR (full screen)
- live orders
- ticket scanner
- **treasury page:** revenue, the split breakdown, supplier purchases, the agent's remaining limits and the decision log

Shared:
- a receipt page at `/r/<invoice_id>` with a link to the explorer

## Schedule

Solo schedule: one workstream at a time, in dependency order.

### Day 0: Wed Nov 11 (rest of day)
- [x] `git init`, layout (`contract/`, `token/`, `app/`, `packages/agents/`, `scripts/`), MIT LICENSE, `.env.example`, `.gitignore`
- [x] Install `cargo-near` (0.23.0)
- [x] Full contract written ahead of schedule: registry, deposits, limits, invoices, group escrow, tickets, revenue split, events
- [x] Demo sUSD token written
- [x] 33 unit tests passing (`cargo test`)
- [x] Deployed to testnet: `sokonipay.testnet` (contract), `susd.sokonipay.testnet` (token)
- [x] `scripts/02-demo.sh` passes end to end on testnet with agent function-call keys: order + revenue split, three refused over-authority calls, group settle, ticket redeem-once, supplier restock, withdraw

### Built ahead of schedule on Nov 11
- [x] `app/lib/agents.ts`: Personal Agent and Merchant Agent (scripted rules, with NEAR AI Cloud as an option), A2A negotiation, invoice check before paying
- [x] Treasury loop: low stock → supplier invoice → paid from revenue under the shop's onchain limits
- [x] Rotating presence QR (HMAC, 10 s windows)
- [x] Customer view `/pay`, shop console `/shop`, receipt page `/r/<id>`, landing page
- [x] Verified through the app on testnet: order, group split, over-limit refusal, ticket + redeem once, table order with presence code, restock
- [x] README with "do X, see Y" steps

### V2 built on Nov 11 (ahead of schedule)
- [x] `backend/`: FastAPI, Postgres schema `sokonipay` on Supabase, key vault, Supabase token check
- [x] NEAR client on py-near, verified against the deployed contract (30 TGas per call; the default 200 exceeds an agent key's allowance)
- [x] Account creation for customers and shops, resumable after a failure, with automatic gas refill
- [x] Two separate agents: `agents/personal.py` (LangGraph ReAct) and `agents/merchant.py` (LangGraph graph), joined only by `agents/a2a.py`; scripted versions of both as the fallback
- [x] Orders API with live streaming, split bills by link, treasury loop, presence codes, shop console API
- [x] `apps/customer` and `apps/merchant` (Vite + React), shared code in `apps/shared`, clean finance look
- [x] Tested on testnet through the Python engine: order, split bill with demo friends, split bill joined by link, over-limit refusal, ticket, and one order with both LLM agents on NEAR AI Cloud (about 38 s)
- [ ] **Not yet tested:** Google sign-in and every signed-in screen in a real browser (needs the redirect URLs below)

Deviations from the plan above: tables are created with SQLAlchemy `create_all` instead of Alembic migrations, and an order's events are stored as JSON on the order row instead of in an `order_events` table.

### Gate tickets and shop setup (built Nov 11, late)
The origin of the project: at the Nairobi Arboretum gate, each person reads a phone number to the cashier, waits for a payment prompt, and goes to the back of the line if it fails.

- [x] Contract upgrade, deployed with a state migration (old balances, receipts and tickets kept): a ticket admits several people and expires at closing time; `redeem(id, count)`; `get_ticket`. 35 contract tests.
- [x] Shop types: **venue** (entry tickets, gate hours) and **food stall** (menu, stock, supplier). The owner enters their own name, place, hours, items and prices. No default menu.
- [x] Manual approval: a new shop is on the onchain register but unverified, hidden from customers and without a code until an admin verifies it.
- [x] Admin page at `/admin` in the merchant console, for emails in `ADMIN_EMAILS`: verify or suspend shops, customer and order counts, gas reserve, latest orders.
- [x] Venue code: static, identifies the venue only, printable. (Food stalls keep the rotating code.)
- [x] Ticket purchase: pick quantities, the Personal Agent asks the Merchant Agent for an invoice, checks it and pays; the Merchant Agent issues the invoice and the ticket. Fixed prices, so no haggling and no LLM call: a few seconds.
- [x] Ticket pass: green while valid, orange after closing, grey when used; live clock and a moving band of light so a screenshot shows; ring artwork drawn from the ticket number; a code the gate scans.
- [x] Gate panel: scan or type a ticket, see who it covers and whether it is valid, let everyone or one person in.
- [x] Tested through the API on testnet: pending shop hidden, approve, buy "2 adults, 1 child", admit 2 then 1, third try refused, closed gate refuses to sell. Ticket pass checked by screenshot in all three states.
- [ ] **Not yet tested in a browser:** the setup wizard, the venue console, the gate scanner, the admin page, the ticket picker.
- [ ] Stretch: mint each ticket as a real NEP-171 NFT (only then enter the `nfts` track)
- [ ] Later: other shop types (barbershop, petrol station, general shop, clothes)

### Clean slate (Nov 11, late)
- [x] All database rows deleted (backup kept outside the repo) and every old test shop removed from the onchain verified register
- [x] No mock data in the code: the seed script, the built-in sample menu, the demo friends and the supplier default are gone. Split bills are by link only. Food stalls have no supplier, so restocking is off until a real supplier can be connected.
- [x] `TEST_PROMPT.md`: a browser test script for the Claude extension, with expected results and a report format
- [ ] Still in the repo: `app/` (v1), which runs on demo accounts. Remove it once v2 is confirmed in the browser.

### Day 1: Thu Nov 12
- [ ] **You:** add `http://localhost:5173/auth/callback` and `http://localhost:5174/auth/callback` to the Supabase redirect URLs
- [ ] Test Google sign-in, first-time setup, and every screen in both apps; fix what breaks
- [ ] Try the customer app on a real phone: camera scan of the shop code
- [ ] LLM agents: test the split bill, refusal and ticket flows; tune prompts; check the fallback models
- [ ] `pytest` for the API routes with a stand-in user
- [ ] Deploy: backend, customer app, merchant console; add the hosted redirect URLs

### Day 2: Fri Nov 13
- [ ] Polish: empty states, errors, loading, accessibility pass, phone widths
- [ ] Withdraw to an outside NEAR account (customer and shop)
- [ ] Stretch: LLM-driven restocking (the Merchant Agent negotiates with a supplier agent)
- [ ] Stretch: NEAR Intents 1Click top-up from another chain (mainnet only)
- [ ] Remove `app/` (v1) once v2 is confirmed in the browser; rewrite the README for v2

### Day 3: Sat Nov 14 (ship; hard stop 18:00 UTC)
- [ ] Deploy backend and both apps; add hosted redirect URLs
- [ ] README final check: custody stated, the other hackathon project named, "do X, see Y" steps match the hosted apps
- [ ] Record a 60–90 s demo: sign in with Google → scan → agents negotiate → pay → receipt, then a group split, then an agent blocked by its limit, then the shop restocking itself
- [ ] Re-read the live HACKATHON.md for rule changes
- [ ] **You:** make the repo public and publish the X post (@NEARProtocol #NEARHackathon, video attached)
- [ ] Build the submission payload → **you confirm** → POST once

## Cut order if behind

1. NEAR Intents 1Click top-up (stretch, mainnet only)
2. Merchant self-signup (ship one seeded shop plus the supplier; keep customer signup)
3. LLM agents (ship `AGENT_MODE=scripted` through the same tools)
4. Settings screens (limits and withdraw stay CLI-only)
5. If v2 is not at parity by Nov 14 06:00 UTC, submit v1 from `app/`

**Never cut:** onchain limits plus the agent function-call key, a single payment with a receipt, group settlement in one transaction, the README demo steps.

## Demo script (for the video and the README)

1. Customer: connect wallet → mint 50 sUSD → deposit 50 → set limits of 20 per payment and 40 per day → authorise the agent.
2. Scan Mama Mboga's QR. The app shows "✓ verified merchant mama-mboga.sokonipay.testnet".
3. Tell the agent "lunch for me, under 10 sUSD". The agents negotiate in the transcript.
4. Invoice appears → the agent pays → the receipt shows an explorer link.
5. Group: three friends' agents each contribute 6 → one `group_settled` event.
6. Ask the agent to buy something for 25 → **the contract rejects it** because it's over the per-payment limit. This shows the security story.
7. Merchant console: revenue is already split 70/20/10. Tomatoes fall below their reorder point → the Merchant Agent gets a quote from the supplier's agent and pays it from revenue. This is the autonomous treasury.

## Risks

| Risk | Mitigation |
|---|---|
| LLM is flaky during the demo | Scripted mode, and code-enforced quote checks |
| The NEAR SDK or API has changed | Check versions in the docs on Day 0 and pin them in lockfiles |
| Camera QR scanning on a phone over HTTPS | Deploy early; paste the QR payload as a fallback |
| Time | Follow the cut order above, with a hard stop at 18:00 UTC on Nov 14 |
