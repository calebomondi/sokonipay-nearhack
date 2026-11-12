# SokoniPay: Agent-to-Agent Commerce

> *Sokoni* is Swahili for "at the market."

## One-liner

Your AI agent pays a shop's AI agent in stablecoins on NEAR. It can spend only within limits you set onchain, and you get an onchain receipt.

## Where it started

At the Nairobi Arboretum gate, each visitor reads a phone number to the cashier and waits for a payment prompt on their phone. If the prompt fails, the cashier can't resend it to the same number straight away, so that person steps aside and often ends up at the back of the line.

With SokoniPay the gate has one printed code that only identifies the venue. Each visitor scans it, picks their tickets, and their agent pays the venue's agent. Everyone in the line does this at once on their own phone, nobody gives out a phone number, and a failed payment is retried on the spot. The ticket on the phone is green until the park closes for the day.

## Problem

Paying a small merchant today means one of these:

- cash
- a card terminal with 2-3% fees and slow settlement
- a mobile-money push where you type the till number, the amount and a PIN, then wait

On the merchant side, someone still writes the order down, totals it, sends an invoice and checks that the money arrived. Group orders mean somebody pays for everyone and then chases each person for their share.

Plugging AI agents in naively makes this worse: giving an agent your wallet's private key means it can spend everything you own.

## Product

Each party has an agent:

- **Merchant Agent:** runs the shop's sales desk. It publishes the catalog, answers requests, applies the merchant's pricing rules (for example, discounts allowed up to 10%), issues invoices onchain and confirms payment.
- **Personal Agent:** the customer's agent. It runs on the SokoniPay backend and is used from a phone web app. It reads the catalog, puts together an order that meets the user's request and budget, negotiates within the merchant's rules, and pays the invoice.

The Personal Agent can spend only through a **NEAR function-call access key**. That key can call exactly one method (`pay_invoice` / `contribute`) on the SokoniPay contract. The contract enforces the user's **per-payment and daily limits**. The agent never holds a key that can move the user's other funds.

### Flow: connect, negotiate, invoice, pay, receipt

1. **Connect.** The customer scans the merchant's QR code or picks the merchant from the directory. The QR code contains the merchant's NEAR account. The app checks that account against the onchain **verified-merchant registry** before connecting, so a fake QR sticker pointing to someone else's account fails.
2. **Negotiate.** The Personal Agent fetches the catalog and exchanges structured messages with the Merchant Agent (`request_quote` → `quote` → `counter` → `accept`). The user sees the conversation as it happens.
3. **Invoice.** The Merchant Agent calls `create_invoice` on the contract. The invoice holds the line items (hash onchain, full list offchain), the amount, the token and an expiry.
4. **Pay.** The Personal Agent calls `pay_invoice`. The contract checks the user's limits, debits the user's deposited stablecoin balance and credits the merchant.
5. **Receipt.** The contract emits a NEP-297 `payment` event and stores a receipt that both sides can look up. The app shows it with a NEAR explorer link.

### Payment types

| Type | Example | What happens |
|---|---|---|
| One-time access | Event entry | Invoice → pay → the receipt is a **ticket**. The merchant scans it at the door and calls `redeem`, so it can't be used twice. |
| Itemised order | Restaurant table | The agents agree a basket → itemised invoice → pay. |
| Group purchase | Friends splitting a meal | One group invoice. Each Personal Agent calls `contribute` with its share, held in the contract. The merchant is paid in **one settlement** once the invoice is fully funded. If it isn't funded before expiry, everyone gets an automatic refund. |

### Merchant treasury (Autonomous Business)

The merchant owner sets the rules. The Merchant Agent runs the money.

- **Revenue sharing at settlement.** The owner configures a split once, for example 70% to the operating balance, 20% to a savings sub-account and 10% to a partner or staff account. Every paid invoice is split by the contract in the same transaction. No one does payouts by hand.
- **Procurement.** The Merchant Agent tracks stock as orders come in. When an item runs low, it requests a quote from a **supplier's** Merchant Agent and pays the supplier's invoice from the shop's operating balance. It uses the same contract and the same A2A protocol, so B2B is just another agent-to-agent purchase.
- **Constraints, not approvals.** The Merchant Agent spends with a function-call key under onchain limits (per payment and per day), exactly like a Personal Agent. The owner never approves each purchase. They set the ceiling, and the contract enforces it.
- **Treasury view.** The console shows revenue, the splits, supplier spend, the remaining limits and an agent decision log.

### Made for a business to run on

- **Priced in shillings, settled in dollars.** The owner types prices in KES and customers see KES. Each sale settles in the dollar stablecoin on NEAR at a live rate, and the dollar amount is shown small beside it.
- **Refunds.** The owner can give any paid sale back in full. The contract returns the money to whoever paid. A ticket can be refunded only while nobody has entered on it, and it stops opening the gate. The agent's key cannot refund.
- **Discount rules the owner sets.** The owner says when a discount may be given and the most it can be: for a large order, a group, a time of day or a returning customer. When the customer's agent asks for a better price, the shop's agent can go up to the best rule the order meets and never past it, and it says which rule applied.
- **Three kinds of business.** A venue sells tickets at a gate. A food stall takes orders from a menu. A counter has no price list: the cashier keys in the amount, the customer scans and their agent pays, which covers petrol stations, kiosks, barbers and general shops.
- **Subscriptions.** A shop offers plans billed weekly or monthly. The person subscribes with their own key, which writes a mandate to the contract: this merchant, this amount, once per period. Each period the shop's agent asks, the person's agent checks the subscription and the balance, and pays. The contract refuses a bill that is early, for a different amount, or for someone who has unsubscribed, and the agent's spending limits still apply. If the balance is short the subscription shows "Needs money" and is paid as soon as money is added.
- **Chat with your agent.** The person can ask their agent about their balance, limits and payments, or tell it what to buy. It finds a verified shop, agrees a price with the shop's agent, then shows the shop and the total and waits. Nothing is paid until the person says yes. The agent-to-agent conversation can be opened and read inside the chat.
- **Running the money.** The owner withdraws the shop's balance as a stablecoin on a chain of their choice, and can move shares the contract set aside (savings) back to the main balance. Both need the owner's key, never the agent's. The console charts sales by day and by hour and shows what sells.
- **A code that is recognisably ours.** Each shop's QR code is drawn with round dots, corner markers in the shop's own colour and its initials in the centre, framed with its name, a checkmark and the SokoniPay mark. A home-made sticker looks wrong beside it.
- **Several shops, one account.** An owner can open up to five shops and switch between them. Each is its own NEAR account with its own balance, code and verification.
- **The owner can ask the shop's agent.** A panel in the console answers questions about the business from its real figures: sales today against yesterday, what sells, stock running low, refused payments, subscribers, the balance. It reads and changes nothing; refunds, withdrawals and prices stay the owner's own actions.
- **A shop introduces itself.** Each shop has a short description, its place and its opening hours. A customer sees these, with the verified account and whether a discount is on offer, before what the shop sells.
- **Businesses only.** A payment can only go to an invoice from a verified shop. There are no person-to-person transfers.
- **Daily statement.** One page per day: sales, refunds, net, people admitted, and how the contract divided each sale between the shop, savings and partners. It prints and downloads as CSV for an accountant.

### Why QR instead of location

- **Privacy.** Scanning identifies the merchant, never the customer. The app collects no GPS data.
- **Reliability.** It works indoors with no GPS errors.
- **Remote by default.** You can order from the directory without being in the shop.
- **Proof of presence when it matters.** For tickets and table orders, the merchant screen shows a **rotating QR code**: an HMAC signature over the merchant account and a 10-second time window. The Merchant Agent accepts the order only if the scanned code is still valid.
- **Anti-scam.** Every QR code resolves to a verified merchant account onchain.

## How NEAR is used

Each item below is concrete, not just "powered by NEAR".

| NEAR feature | Role in SokoniPay |
|---|---|
| Own contract (`sokonipay`, Rust) | Merchant registry, invoices, escrow for group purchases, spending limits, revenue splits, receipts and tickets |
| NEP-141 stablecoin | Invoices are priced and settled in a stablecoin. Testnet uses a demo token. Mainnet would use native USDC. |
| **Function-call access keys** | The Personal Agent's key can only call `pay_invoice` / `contribute` on our contract and cannot attach deposits. This is the security model. |
| Named accounts / sub-accounts | `mama-mboga.sokonipay.testnet` is easy for a person to check. Each agent has its own account, so every onchain action traces back to a specific agent. |
| NEP-297 events | Machine-readable receipts that an indexer or accountant can consume |
| NEAR AI Cloud | LLM inference for both agents (LangGraph, two separate graphs) |
| NEAR Intents 1Click | "Add money" takes whichever stablecoin the user holds, on any of 25 chains, grouped by chain, with a live quote. Intents is mainnet only, so by default the quote is real and the balance is credited in demo sUSD. With a mainnet treasury account configured, a real deposit settles as USDC on NEAR and the same amount is credited on testnet. |

## Tracks

| Track | Fit | Why |
|---|---|---|
| `realworld`: Real-World Money | **Main** | Merchant payments, invoicing, stablecoin settlement and receipts that a small shop could use tomorrow |
| `agents`: Agent Economy | Strong | Agents negotiate, issue invoices and pay one another |
| `swarms`: AI Swarms | Good | Collective purchasing: several Personal Agents fund one group invoice that settles in a single transaction |
| `security`: AI Security & Defense | Good (added) | Spending limits enforced onchain plus a function-call key that can call only one method. "Give AI money without giving it the keys to everything" is a direct match. |
| `business`: Autonomous Business | Good | The Merchant Agent runs the treasury as well as sales: revenue is split automatically at settlement, and the agent restocks by paying suppliers within limits the owner sets. See "Merchant treasury" above. |

**Submission:** `realworld`, `agents`, `swarms`, `security`, `business`.

## Refinements from the original idea

1. **The agent's spending authority is the core idea.** A function-call key plus onchain limits turns "my agent pays for me" from a risk into something a user can trust. It is also what makes the project eligible for `security`.
2. **Deposit-balance model.** NEP-141 `ft_transfer_call` requires a 1 yoctoNEAR deposit, and function-call keys can't attach deposits. So the user deposits stablecoin into the contract once, with their own full-access wallet, and the agent spends from that balance. This keeps the security model intact.
3. **The verified-merchant registry is onchain**, not a server list, so the anti-fake-sticker claim can be checked.
4. **The rotating QR code is HMAC over a time window.** It is cheap to build and proves presence without any location data.
5. **Testnet first.** Judges can reproduce everything for free. Mainnet-only Intents is a stretch goal (Q-007 / Q-010).
6. **Scripted agent mode.** Both agents can run on deterministic rules instead of the LLM, so judges can reproduce the full flow without an API key.

## Out of scope for the hackathon

- Self-custody. Users sign in with Google and the backend holds their NEAR account (custodial). Connecting your own wallet comes later.
- Native mobile apps. The customer app is a mobile-first PWA that can be installed to the home screen and uses the camera for QR scans. A React Native port comes after the hackathon.
- Fiat on/off-ramp
- Merchant KYC (an admin marks merchants as verified)
- Settling in several stablecoins. Users can pay in with any stablecoin; balances and invoices use one dollar token. Merchant payout to a chosen coin and chain comes next.
- Mainnet deployment
