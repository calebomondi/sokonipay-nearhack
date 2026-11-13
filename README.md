# SokoniPay

Every business gets an AI agent that sells for it, and every customer gets an AI agent that pays for them. The two agents agree a price and settle in a dollar stablecoin on NEAR. A NEAR contract caps what the customer's agent can spend, so it can pay but cannot overspend, withdraw or change its own limits.

*Sokoni* is Swahili for "at the market". Built for NEAR HACKATHON, November 2026. Tracks: `realworld`, `agents`, `swarms`, `security`, `business`.

| | |
|---|---|
| User app | https://sokonipay.up.railway.app |
| Business console | https://merchant-sokonipay.up.railway.app |
| Contract | [`sokonipay.testnet`](https://testnet.nearblocks.io/address/sokonipay.testnet) on NEAR testnet |
| Demo token | [`susd.sokonipay.testnet`](https://testnet.nearblocks.io/address/susd.sokonipay.testnet) (sUSD, 6 decimals, no value) |

Sign-in is with Google on both. It creates a NEAR testnet account and demo money. No wallet is needed.

## The problem

Think of a queue you have stood in: a stadium gate, a festival entrance, a busy café, a fuel station at rush hour. Everyone already has a phone in their hand, yet the line moves one payment at a time, and one failed payment holds up everyone behind it.

The project started at the gate of the Nairobi Arboretum, a park in Kenya. In Kenya most payments are made by mobile money from a phone, so cash and cards are not the bottleneck: the steps are. Each visitor reads their phone number to the cashier, waits for a payment prompt, and enters a PIN. If the prompt fails, the cashier can't resend it to the same number straight away, so that visitor steps aside and often ends up at the back of the line. The same pattern, one person and one prompt at a time, repeats at every till that sells this way.

## The idea

1. **Businesses keep moving to where their customers are.** First a website, then social media. Customers are now starting to hand tasks to AI agents: find me lunch, get two tickets, fill up for KES 1,500. An agent cannot read a shop's Instagram post and pay at its till. A business that has no agent of its own is invisible to them.
2. **A business needs an agent that runs a virtual version of its counter.** In SokoniPay that agent holds the price list, the discount rules the owner set, the tickets, refunds and subscriptions. It answers customers' agents, issues invoices on NEAR and confirms payment. The owner sets the rules once and watches the results in a console.
3. **Agent to agent is faster than person to person.** The business shows one printed code that only says who it is. Every customer in the line scans it at the same moment on their own phone, and their agents settle with the business's agent in seconds. Nobody reads out a number or waits for a prompt, and a failed payment is retried on the spot instead of at the back of the line.
4. **It matters most where businesses are small and phones are everywhere.** Where most small businesses are informal and most customers already pay from a phone, a printed code and an agent is a cheap way in: no card terminal, no website to build. Nairobi is where it was designed and tested; the queue it removes exists everywhere.
5. **An agent with money needs hard limits.** Giving an agent the key to your wallet lets it spend everything. In SokoniPay each agent holds a NEAR function-call key that can call only a few contract methods and cannot attach a deposit. The contract checks the customer's per-payment and daily limit on every payment. Anything that moves authority or takes money out (limits, withdrawals, refunds, revenue splits, subscriptions) needs the owner's own key.
6. **People can talk to their agent instead of typing.** Many people would rather say what they want than type it, and a cashier serving a queue has their hands full. Customers and owners can speak to their agents and hear the answers, through ElevenLabs. The recording stops by itself when the person stops talking. Speaking never pays for anything: a payment still needs a tap on "Yes, pay".

A payment can only go to an invoice issued by a verified business. There are no person-to-person transfers.

## Try it as a judge (about 10 minutes)

Each row is something to do and what you should see. All money is demo money.

### 1. As a customer: https://sokonipay.up.railway.app

| Do this | See this |
|---|---|
| Sign in with Google | A balance of about KES 6,500 (50 demo dollars) and the card "Agent spend limit today": up to about KES 2,600 per payment and KES 10,400 a day. Your agent can spend only inside these; the contract checks them on every payment. |
| Home → "All shops" → "Nairobi Arboretum" → pick 2 Adult → "Get 2 tickets" | The two agents' conversation, then a green ticket with a ticking clock and a QR code. The balance drops. "See the payment on NEAR" opens the transaction. |
| On the same page pick 20 Adult and buy | The venue's agent may offer its group discount first. Then a red box: "The contract refused this payment", naming the per-payment limit. Nothing is paid. The refused transaction is linked. |
| Home → "Limits" → lower the per-payment limit → buy again | The contract now refuses a smaller purchase. Only you can change limits; the agent cannot. |
| "Kilimani Service Station" → pick Diesel → type `1500` | "KES 1,500 buys 12 litres of Diesel at KES 125 a litre." You name the money; the station's agent works out the quantity from its price list. Pay, and you get a three-digit code to show the cashier. |
| "Chat" → type `Get me 2 adult tickets at the Arboretum` | The agent finds the venue and agrees a price with the venue's agent (their conversation is shown as it happens), then stops at "Shall I pay Nairobi Arboretum?" with the total. Nothing is paid until you tap "Yes, pay". Tap "Not now": nothing is paid, and the agent says so. |
| "Chat" → tap the speaker icon at the top, then the microphone (allow it when the browser asks) → say "What's my balance?" → stop talking | About a second after you stop, your words appear as your message (ElevenLabs speech to text), then the answer, read aloud (ElevenLabs text to speech). You don't tap anything to finish. Say nothing and it stops after 6 seconds with "I didn't hear anything". |
| "Mama Njeri's Kitchen" → choose 2 people → type `lunch for two` → "Send my agent" | The agents agree a meal. If a discount rule fits, the stall's agent gives the full discount that rule allows and names it ("10% off for groups of 2 or more"). Your share goes into escrow in the contract, and "Copy link" gives a link for a friend to pay theirs. The stall is paid once, when the last share arrives. If the bill expires first (after an hour), every share comes back. |
| "Kasarani Fibre" → subscribe to a plan | An in-app confirmation, then a monthly mandate written to the contract and the first bill paid. Under "Subs" you can pause, resume or cancel. The contract refuses a bill that is early, for a different amount, or after cancelling. |
| Home → "Add money" → pick a chain and a stablecoin → 25 | A live quote from NEAR Intents. "Try it with demo money" credits the quoted amount in demo dollars. |
| "Activity" | Every payment, refund, held share and top-up, red for money out and green for money in |

### 2. As a business: https://merchant-sokonipay.up.railway.app

Use the same Google account or another one.

| Do this | See this |
|---|---|
| Sign in → choose a kind of business (venue, food stall, counter) → name it → for a venue or stall, add prices in KES | A live preview of the business as customers will see it, then "Opening your shop" (about 20 seconds: a NEAR account, the onchain register, an agent key). A counter adds its items afterwards under "Price list", for example Bread, 65, for each loaf, "Whole only". |
| Look at the console | "Not verified yet", and no code. A new business is hidden from customers until it is verified on the onchain register. |
| Click "Verify my shop (demo)" | The shop is put on the register with the contract's `set_verified`, the same call an admin sends, and the console shows its code. This button exists only in the hosted demo, and only for your own new shop (see "Verifying businesses" below). |
| In the user app, find your business and buy from it (for the counter above: Bread, `200`) | "KES 200 buys 3 loaves of Bread at KES 65 a loaf. I'll charge KES 195, not KES 200." The sale appears in the console without a reload: Today, the sales chart, and for a counter the "To hand over" list with the customer's code |
| Counter: click "Handed over" on that sale | A `redeem` on the contract. It can happen once, and after it the contract refuses a refund. The customer's pass turns to "Collected". |
| Refund a sale that hasn't been handed over or used | The contract returns the money to whoever paid. The customer sees it in Activity. |
| "Ask your agent" → `How did we do today?`, typed or spoken with the microphone | An answer from the business's real figures, for example sales, refunds and net for the day. This agent reads and changes nothing. |
| Counter: "Read payments aloud" on the till | Each new payment is announced as it arrives, so a cashier serving a queue doesn't have to watch the screen |
| Settings → split 10% to savings, then sell again | The contract divides the next sale in the same transaction. "Daily statement" shows it, and downloads as CSV. |

### Verifying businesses

A real deployment verifies each business by hand before customers can find it. That check is what stops someone printing a fake code that points to their own account: a customer's agent refuses to pay an account that isn't on the onchain register.

To let judges try the whole flow, the hosted demo runs with `DEMO_SELF_VERIFY=true`. It adds the "Verify my shop (demo)" button. The button works only on the owner's own business while it is waiting to be verified, and never lifts a suspension. Judges are not made admins, because an admin can also suspend any business, including the demo businesses other judges are using.

## How it works

```
 Customer's phone                     SokoniPay backend                         NEAR testnet
 ────────────────                     ─────────────────                         ────────────
 scans the business's code  ──────▶  Personal Agent ◀── A2A messages ──▶ Business Agent
 "fill up for KES 1,500"             (customer's key:                      (business's key:
                                       pay_invoice, contribute)              create_invoice, redeem)
                                            │                                       │
                                            │ pay_invoice                           │ create_invoice
                                            ▼                                       ▼
                                     ┌───────────────────── sokonipay contract ─────────────────────┐
                                     │ register of verified businesses · invoices · spending limits │
                                     │ escrow for split bills · tickets · refunds · splits · plans  │
                                     └──────────────────────────────────────────────────────────────┘
```

1. **Connect.** The code holds only the business's NEAR account. The customer's agent checks that account against the onchain register before it talks to it.
2. **Agree.** The two agents exchange structured messages: `request_quote`, `quote`, `counter`, `accept`. The business's prices and discount rules are set by its owner; when the customer's agent asks for a better price, it gets exactly what the rules allow.
3. **Invoice.** The business's agent calls `create_invoice`: the amount, a hash of the line items, the kind (single, ticket or split bill) and an expiry.
4. **Pay.** The customer's agent calls `pay_invoice` with its function-call key. The contract checks the per-payment and daily limits, moves the stablecoin and splits it if the business set a split.
5. **Receipt.** The contract emits a NEP-297 event. The app shows the receipt or ticket with an explorer link.

The two agents are separate LangGraph graphs on NEAR AI Cloud. They share no memory, tools or keys. Setting `AGENT_MODE=scripted` runs both on fixed rules with no model.

## How NEAR is used

| NEAR feature | What it does here |
|---|---|
| Our contract, `contract/` (Rust, near-sdk 5) | The register of verified businesses, invoices, escrow for split bills, agent spending limits, revenue splits, tickets, refunds and subscription mandates |
| Function-call access keys | The whole security model. A customer's agent key can call `pay_invoice` and `contribute`. A business's agent key can call `create_invoice`, `pay_invoice` and `redeem`. Neither can attach a deposit, so neither can call anything that needs 1 yoctoNEAR. |
| NEP-141 token | Invoices are priced and settled in one stablecoin. Testnet uses our demo token; a mainnet deployment would name native USDC when the contract is initialised. |
| Named sub-accounts | Every user and business is `<name>.sokonipay.testnet`, so each onchain action traces to one account. |
| NEP-297 events | `payment`, `revenue_split`, `refund`, `subscribe`, `withdraw` and others, for an indexer or an accountant |
| NEAR AI Cloud | Inference for both agents and the chat agent |
| NEAR Intents 1Click API | Live quotes for adding and withdrawing money in the stablecoins of about 25 chains |

### Other services

| Service | What it does here |
|---|---|
| ElevenLabs | Speech to text (Scribe) when someone speaks to their agent, and text to speech (Flash) for the agent's answers and for announcing payments at the till. Amounts are read as "1,274 shillings". The API key stays on the backend, and recordings and spoken replies are length-capped. Without a key, the voice buttons don't appear and the till uses the browser's own voice. |
| Supabase | Google sign-in, and the Postgres database for the hosted demo |
| Railway | Hosts the backend and both apps |

### The contract

| Method | Who can call it | What it does |
|---|---|---|
| `set_limits` | Owner (1 yocto) | Sets the per-payment and daily limit for the caller's agent |
| `create_invoice` | Verified business, or its agent key | Issues an invoice: single, ticket or split bill |
| `pay_invoice` | Customer, or their agent key | Pays an invoice. With an agent key the limits apply. |
| `contribute` / `refund_expired` | Customer or agent / anyone | Pays a share of a split bill into escrow / returns every share if it expires unpaid. The backend calls `refund_expired` every two minutes, so nobody has to claim their money back. |
| `redeem` | Business or its agent key | Lets ticket holders in, or marks a counter sale handed over. Refuses a used-up or expired ticket. |
| `refund` | Business owner (1 yocto) | Returns a paid invoice in full to whoever paid. A ticket only if nobody has entered on it, and a counter sale only before it is handed over. |
| `set_revenue_split` | Business owner (1 yocto) | Divides every sale between the business and other accounts, in the same transaction |
| `sweep` | Business owner (1 yocto) | Moves a balance held by the business's own sub-account (savings) back to the business |
| `subscribe` / `unsubscribe` | Customer (1 yocto) | Lets one business bill a fixed amount once per period. The contract refuses a bill that is early, for a different amount, or after unsubscribing. |
| `withdraw` | Owner (1 yocto) | Takes tokens out of the SokoniPay balance |
| `set_verified` | Contract owner | Puts a business on, or takes it off, the register |

## Three kinds of business

| Kind | Example | How customers pay |
|---|---|---|
| Venue | A park, a museum, an event | Pick tickets, get a ticket with a QR code that the gate scans. It admits the number of people paid for and expires when the venue closes. |
| Food stall | A restaurant, a market kitchen | Order from the menu, alone or split with friends. The owner's discount rules apply. |
| Counter | A fuel station, a kiosk, a barber | Name the money ("KES 1,500 of diesel") and the agent works out the quantity, or pay the amount the cashier keyed in. The customer gets a code; the cashier hands over and marks it collected. |

Any of them can also sell weekly or monthly plans (an internet provider, a gym), split each sale with savings or a partner, refund, withdraw, and print a daily statement.

## What is real and what is simulated

Real, and checkable:

- The contract is deployed on NEAR testnet. Every payment, refusal, refund, ticket admission, split and subscription bill is a transaction with an explorer link in the app.
- The limits are enforced by the contract, not by the app. The refusal in "Try it" is the contract panicking.
- The agents run on NEAR AI Cloud.
- Add money and Withdraw show live quotes from the NEAR Intents 1Click API.

Simulated, and labelled in the app:

- The dollars are a demo token (sUSD) that anyone can mint on testnet. It has no value.
- NEAR Intents runs on mainnet only. "Add money" credits the quoted amount in demo dollars, and "Withdraw" takes demo dollars out of the balance, but no real coins move on the other chain. A real-deposit path exists in the code (`INTENTS_TREASURY`) and is switched off.
- Shilling prices are converted at a live KES/USD rate. There is no route to or from mobile money or a bank; that needs a licensed partner.
- The demo businesses are invented. "Nairobi Arboretum" is named after the place the idea came from and is not connected to it.

Limits of the hackathon build:

- **Custodial.** Users sign in with Google and the backend holds each account's keys, encrypted. The agent key and the owner key are separate keys with separate powers onchain, but both are held by the server.
- **Verification is manual**, apart from the demo button above.
- **One backend instance.** A confirmation waiting for a "yes" and the double-payment lock are held in memory.

## Repository

| Path | What is there |
|---|---|
| `contract/` | The SokoniPay contract and its 52 unit tests |
| `token/` | The demo NEP-141 token |
| `backend/` | FastAPI service: accounts, the two agents (`app/agents/`), orders, chat, subscriptions, NEAR Intents quotes, voice |
| `apps/customer/` | The user app (Vite, React) |
| `apps/merchant/` | The business console and the admin page |
| `apps/shared/` | Code both apps use |
| `scripts/` | Deploy the contracts, run everything locally |
| `app/` | The first version (Next.js, no accounts). Kept for reference; not deployed. |
| `PROJECT.md`, `BUILD.md` | What the product is and how it was built |
| `JUDGE_TEST_PROMPT.md` | The README's judge path as a browser-agent test, with expected results and a report format |
| `TEST_PROMPT.md`, `RETEST_PROMPT.md` | The full browser test and the retest, with expected results |

## Run the tests

```sh
cargo test -p sokonipay          # 52 contract tests
cd backend && uv run pytest      # 10 pricing, discount and counter tests
cd apps && npm ci && npm run build
```

## Run it yourself

The hosted demo is the quick path. Running your own copy needs a NEAR testnet account for the contract, a Supabase project for Google sign-in, and optionally keys for NEAR AI Cloud and ElevenLabs. The database runs locally in Docker.

Tools: Docker, Rust with `cargo-near`, `near-cli-rs`, `uv`, Node 20 or later.

```sh
# 1. Contracts: builds both and deploys them to testnet. Reads the account's key from ~/.near-credentials.
SOKONIPAY_CONTRACT=<your-account>.testnet ./scripts/01-deploy.sh

# 2. Backend settings
cp backend/.env.example backend/.env      # fill in Supabase, ROOT_ACCOUNT_KEY, KEY_VAULT_SECRET, ADMIN_EMAILS

# 3. App settings
cp apps/customer/.env.example apps/customer/.env.local
cp apps/merchant/.env.example apps/merchant/.env.local

# 4. Everything at once: Postgres in Docker, backend on :8010, user app on :5173, console on :5174
(cd apps && npm ci) && ./scripts/dev.sh
```

`backend/.env.example` sets `DATABASE_URL` to the Postgres container in `docker-compose.yml` (port 5433), so local data is separate from any hosted database. `./scripts/db-reset.sh` empties it and `./scripts/db-shell.sh` opens a SQL prompt. Without `DATABASE_URL`, the backend uses the Postgres in `SUPABASE_DB_CONN_STR`.

In Supabase, add `http://localhost:5173/auth/callback` and `http://localhost:5174/auth/callback` to the allowed redirect URLs. The account in `ADMIN_EMAILS` can open `/admin` on the console to verify businesses. Set `DEMO_SELF_VERIFY=true` to show the owner's own "Verify my shop (demo)" button instead.

Leave `NEAR_AI_CLOUD_API_KEY` empty, or set `AGENT_MODE=scripted`, to run the agents without a model. Leave `ELEVENLABS_API_KEY` empty and the voice buttons do not appear.

## Other project by the same author

The author also built [Thalace Shops](https://github.com/calebomondi/thalace-shops) for this hackathon. The two are separate projects with separate code and contracts:

- **Thalace Shops** is about a business selling online: each shop has an agent and a wallet on NEAR Intents, and sells to people and to other agents.
- **SokoniPay** is about a customer paying a business in person: one code at the gate or till, a customer agent with onchain spending limits, and its own contract for invoices, tickets, refunds and subscriptions.

They are in separate repositories. They use the same Supabase project for sign-in and Postgres, in separate schemas.

## License

MIT. See `LICENSE`.
