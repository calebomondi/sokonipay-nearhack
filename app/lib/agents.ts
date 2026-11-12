import "server-only";
import crypto from "node:crypto";
import { personaName } from "./config";
import { llmJson } from "./llm";
import { ContractError, agentCall, view } from "./near";
import { verifyPresence } from "./presence";
import { addLog, getMerchant, persist, store, type Ev, type Item, type Line, type Merchant, type Session } from "./store";
import { fmt, toMicro } from "./units";

export type OrderInput = {
  merchant: string;
  customer: string;
  /** Other customers whose agents split the bill with the customer. */
  friends?: string[];
  goal: string;
  mode: "table" | "pickup";
  presence?: string;
};

type Emit = (e: Ev) => void;
type Invoice = { id: string; merchant: string; amount: string; status: string; kind: string; funded: string };

const subtotal = (lines: Line[]) => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
const list = (lines: Line[]) => lines.map((l) => `${l.qty} × ${l.name}`).join(", ");
const newId = (p: string) => `${p}-${crypto.randomBytes(5).toString("hex")}`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Personal Agent

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function parseGoal(goal: string, groupSize: number) {
  const g = goal.toLowerCase();
  const b = g.match(/(?:under|below|max|maximum|budget(?: of)?|less than|up to|at most)\s*\$?\s*(\d+(?:\.\d+)?)/);
  const p = g.match(/for\s+(\d+|one|two|three|four|five|six)\b/);
  const people = Math.max(groupSize, p ? WORDS[p[1]] ?? parseInt(p[1]) : 1);
  return {
    people,
    budget: b ? toMicro(parseFloat(b[1])) : undefined,
    veg: /\b(veg|vegetarian|vegan|no meat|meatless)\b/.test(g),
    ticket: /\b(ticket|entry|band|event|admission)\b/.test(g),
    noDrink: /\bno drinks?\b/.test(g),
  };
}

/** Scripted basket: named items if the user named any, otherwise a main + side + drink per person, trimmed to budget. */
function scriptedBasket(m: Merchant, goal: string, groupSize: number): Line[] {
  const { people, budget, veg, ticket, noDrink } = parseGoal(goal, groupSize);
  const g = goal.toLowerCase();
  const ok = (i: Item) => i.stock > 0 && (!veg || !i.tags.includes("meat"));
  const line = (i: Item, qty: number): Line => ({ sku: i.sku, name: i.name, qty, unitPrice: i.price });

  if (ticket) {
    const t = m.items.find((i) => i.tags.includes("ticket"));
    return t ? [line(t, 1)] : [];
  }
  const food = m.items.filter((i) => !i.tags.includes("ticket") && ok(i));
  const named = food.filter((i) => i.name.toLowerCase().split(" ").some((w) => w.length > 3 && g.includes(w)) || g.includes(i.sku));
  let lines: Line[];
  if (named.length) {
    lines = named.map((i) => {
      const q = g.match(new RegExp(`(\\d+|one|two|three|four|five|six)\\s+(?:x\\s+)?(?:\\w+\\s+)?${i.name.toLowerCase().split(" ").pop()}`));
      return line(i, Math.min(i.stock, q ? WORDS[q[1]] ?? parseInt(q[1]) : people));
    });
  } else {
    const perHead = budget ? budget / people : Infinity;
    const pick = (tag: string, cap: number) =>
      food.filter((i) => i.tags.includes(tag) && i.price <= cap).sort((a, b) => b.price - a.price)[0];
    const main = pick("main", perHead * 0.75) ?? food.filter((i) => i.tags.includes("main")).sort((a, b) => a.price - b.price)[0];
    const side = pick("side", Math.max(0, perHead - (main?.price ?? 0)) * 0.7);
    const drink = noDrink ? undefined : pick("drink", Math.max(0, perHead - (main?.price ?? 0) - (side?.price ?? 0)));
    lines = [main, side, drink].filter(Boolean).map((i) => line(i!, Math.min(i!.stock, people)));
  }
  return trimToBudget(lines, budget);
}

/** Drop the cheapest extras first until the subtotal fits (the merchant's discount may then bring it lower). */
function trimToBudget(lines: Line[], budget?: number) {
  if (!budget) return lines;
  const out = lines.map((l) => ({ ...l }));
  while (subtotal(out) > budget && out.length > 1) out.sort((a, b) => a.unitPrice - b.unitPrice).shift();
  while (subtotal(out) > budget && out[0]?.qty > 1) out[0].qty -= 1;
  return out;
}

async function planBasket(m: Merchant, goal: string, groupSize: number): Promise<{ lines: Line[]; by: "llm" | "rules" }> {
  const { budget } = parseGoal(goal, groupSize);
  const menu = m.items.filter((i) => i.stock > 0).map((i) => ({ sku: i.sku, name: i.name, price_usd: i.price / 1e6, tags: i.tags, in_stock: i.stock }));
  const ai = await llmJson<{ items: { sku: string; qty: number }[] }>(
    "You are a customer's shopping agent. Choose items from the menu that best satisfy the customer's request, for the number of people they mention, staying within any budget. If they want a ticket or entry, choose only the ticket item with qty 1. Schema: {\"items\":[{\"sku\":string,\"qty\":integer}]}",
    JSON.stringify({ request: goal, people_in_group: groupSize, menu }),
  );
  if (ai?.items?.length) {
    const lines = ai.items
      .map((x) => ({ i: m.items.find((i) => i.sku === x.sku), qty: Math.floor(Number(x.qty)) }))
      .filter((x) => x.i && x.qty > 0 && x.qty <= x.i.stock)
      .map((x) => ({ sku: x.i!.sku, name: x.i!.name, qty: x.qty, unitPrice: x.i!.price }));
    if (lines.length) return { lines: trimToBudget(lines, budget), by: "llm" };
  }
  return { lines: scriptedBasket(m, goal, groupSize), by: "rules" };
}

// ---------------------------------------------------------------- Merchant Agent

/** The most the merchant's rules allow for this order. The agent can offer less, never more. */
export function allowedDiscountBps(m: Merchant, lines: Line[], isGroup: boolean) {
  if (lines.some((l) => m.items.find((i) => i.sku === l.sku)?.tags.includes("ticket"))) return 0;
  const sub = subtotal(lines);
  const tier = m.rules.tiers.find((t) => sub >= t.min)?.bps ?? 0;
  return Math.max(tier, isGroup && sub >= toMicro(8) ? m.rules.groupBps : 0);
}

/** Price the request from the catalog (never from the customer's message) and check stock. */
function priceRequest(m: Merchant, wanted: Line[]): { lines: Line[]; missing: string[] } {
  const lines: Line[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const i = m.items.find((x) => x.sku === w.sku);
    if (!i || i.stock <= 0) missing.push(w.name);
    else lines.push({ sku: i.sku, name: i.name, qty: Math.min(w.qty, i.stock), unitPrice: i.price });
  }
  return { lines, missing };
}

async function decideDiscount(m: Merchant, lines: Line[], isGroup: boolean, ask: string) {
  const max = allowedDiscountBps(m, lines, isGroup);
  if (max === 0) return { bps: 0, max };
  const ai = await llmJson<{ discount_percent: number }>(
    `You are the sales agent for ${m.name}. A customer's agent asked for a better price. You may give between 0 and ${max / 100} percent off this order. Give more for larger orders. Schema: {"discount_percent":number}`,
    JSON.stringify({ order: lines.map((l) => ({ name: l.name, qty: l.qty })), subtotal_usd: subtotal(lines) / 1e6, group_order: isGroup, customer_message: ask }),
  );
  const bps = ai && Number.isFinite(ai.discount_percent) ? Math.round(ai.discount_percent * 100) : max;
  return { bps: Math.max(0, Math.min(max, bps)), max }; // clamp: rules beat the model
}

// ---------------------------------------------------------------- One order, end to end

export async function runOrder(input: OrderInput, emit0: Emit): Promise<Session> {
  const m = getMerchant(input.merchant);
  const members = [input.customer, ...(input.friends ?? []).filter((f) => f !== input.customer)];
  const isGroup = members.length > 1;
  const me = `${personaName(input.customer)}'s agent`;
  const shop = `${m?.name ?? input.merchant} agent`;
  const session: Session = {
    id: newId("s"), merchant: input.merchant, customer: input.customer, members, goal: input.goal,
    mode: input.mode, status: "negotiating", events: [], createdAt: Date.now(),
  };
  store.sessions.unshift(session);
  store.sessions.length = Math.min(store.sessions.length, 50);
  const emit: Emit = (e) => {
    session.events.push(e);
    if (e.t === "done") persist();
    emit0(e);
  };
  const fail = (text: string) => {
    session.status = "failed";
    emit({ t: "error", text });
    emit({ t: "done" });
    return session;
  };

  try {
    // 1. Connect: check the merchant against the onchain registry before talking to it.
    if (!m) return fail("This merchant is not in the SokoniPay directory.");
    const verified = await view<boolean>("is_verified", { account_id: m.id });
    if (!verified) return fail(`${m.id} is not a verified merchant. Not connecting.`);
    emit({ t: "status", ok: true, text: `Verified merchant: ${m.id}` });

    if (input.mode === "table" && m.rules.presenceForTable) {
      if (!verifyPresence(m.id, input.presence)) return fail("That table code has expired. Scan the code on the shop's screen again.");
      emit({ t: "status", ok: true, text: "You're at the shop: presence code accepted. No location was shared." });
    }

    // 2. Negotiate.
    const plan = await planBasket(m, input.goal, members.length);
    if (!plan.lines.length) return fail("Your agent found nothing on the menu that matches. Try naming a dish.");
    const { budget } = parseGoal(input.goal, members.length);
    emit({
      t: "msg", from: "personal", who: me, kind: "request_quote", lines: plan.lines,
      text: `Hello. ${isGroup ? `I'm ordering for ${members.length} people: ` : "I'd like "}${list(plan.lines)}. What's your price?`,
    });
    await pause(500);

    const priced = priceRequest(m, plan.lines);
    let lines = priced.lines;
    const missing = priced.missing;
    if (!lines.length) return fail(`${m.name} is out of ${missing.join(", ")}.`);
    let total = subtotal(lines);
    emit({
      t: "msg", from: "merchant", who: shop, kind: "quote", lines, total,
      text: `${missing.length ? `We're out of ${missing.join(", ")}. ` : ""}That comes to ${fmt(total)} sUSD.`,
    });
    await pause(500);

    const ask = budget && total > budget
      ? `My customer's budget is ${fmt(budget)} sUSD. Can you do better on ${fmt(total)}?`
      : `Can you do better on ${fmt(total)}${isGroup ? " for a group order" : ""}?`;
    emit({ t: "msg", from: "personal", who: me, kind: "counter", text: ask });
    await pause(400);

    const d = await decideDiscount(m, lines, isGroup, ask);
    total = subtotal(lines) - Math.floor((subtotal(lines) * d.bps) / 10_000);
    emit({
      t: "msg", from: "merchant", who: shop, kind: "quote", lines, total, discountBps: d.bps,
      text: d.bps > 0
        ? `I can take ${d.bps / 100}% off${isGroup ? " for the group" : ""}: ${fmt(total)} sUSD. That's my best price.`
        : `${fmt(total)} sUSD is already my best price for this order.`,
    });
    await pause(400);

    if (budget && total > budget) {
      // Still over budget: drop extras and take the merchant's price for the smaller order.
      lines = trimToBudget(lines, budget);
      const bps = Math.min(d.bps, allowedDiscountBps(m, lines, isGroup));
      total = subtotal(lines) - Math.floor((subtotal(lines) * bps) / 10_000);
      if (total > budget) return fail(`Nothing on the menu fits ${fmt(budget)} sUSD. Your agent did not order.`);
      emit({ t: "msg", from: "personal", who: me, kind: "counter", lines, text: `Still over budget. Make it ${list(lines)} instead.` });
      await pause(300);
      emit({ t: "msg", from: "merchant", who: shop, kind: "quote", lines, total, discountBps: bps, text: `Done: ${fmt(total)} sUSD.` });
    }
    emit({ t: "msg", from: "personal", who: me, kind: "accept", total, text: `Agreed at ${fmt(total)} sUSD. Send the invoice.` });

    // 3. Invoice: the Merchant Agent writes it onchain with its function-call key.
    const isTicket = lines.length === 1 && !!m.items.find((i) => i.sku === lines[0].sku)?.tags.includes("ticket");
    const kind = isTicket ? "Ticket" : isGroup ? "Group" : "Single";
    const invoiceId = newId(isTicket ? "tkt" : isGroup ? "grp" : "ord");
    const itemsHash = crypto.createHash("sha256").update(JSON.stringify(lines)).digest("hex");
    const created = await agentCall(m.id, "create_invoice", {
      id: invoiceId, amount: String(total), items_hash: itemsHash, kind,
      payer: kind === "Group" ? null : input.customer, expires_in_sec: 900,
    });
    Object.assign(session, { status: "invoiced", invoiceId, kind, total, lines });
    emit({ t: "tx", who: shop, label: "Invoice issued onchain", hash: created.hash });
    emit({ t: "invoice", id: invoiceId, total, kind, lines });

    // 4. Pay: the Personal Agent re-reads the invoice from the chain and pays only if it matches the deal.
    const onchain = await view<Invoice>("get_invoice", { id: invoiceId });
    if (!onchain || onchain.merchant !== m.id || Number(onchain.amount) !== total || onchain.status !== "Open") {
      return fail("The onchain invoice does not match the agreed quote. Your agent did not pay.");
    }
    const payers: { id: string; amount: number }[] = [];
    try {
      if (kind === "Group") {
        const share = Math.floor(total / members.length);
        for (const [n, id] of members.entries()) {
          const amount = n === members.length - 1 ? total - share * (members.length - 1) : share;
          const r = await agentCall(id, "contribute", { id: invoiceId, amount: String(amount) });
          payers.push({ id, amount });
          emit({ t: "tx", who: `${personaName(id)}'s agent`, label: `Paid a ${fmt(amount)} sUSD share into escrow`, hash: r.hash });
        }
      } else {
        const r = await agentCall(input.customer, "pay_invoice", { id: invoiceId });
        payers.push({ id: input.customer, amount: total });
        emit({ t: "tx", who: me, label: `Paid ${fmt(total)} sUSD`, hash: r.hash });
      }
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      session.status = "refused";
      const paidSoFar = payers.length
        ? ` ${payers.length} of ${members.length} shares are in escrow and are refunded automatically if the invoice expires unpaid.`
        : "";
      emit({ t: "refused", reason: e.message, hash: e.txHash, text: `The contract refused the payment: ${e.message}.${paidSoFar}` });
      addLog({ merchant: m.id, kind: "refused", text: `Payment for ${invoiceId} refused onchain: ${e.message}`, hash: e.txHash });
      emit({ t: "done" });
      return session;
    }

    // 5. Receipt.
    session.status = "paid";
    emit({ t: "receipt", id: invoiceId, total, kind, payers });
    for (const l of lines) {
      const i = m.items.find((x) => x.sku === l.sku);
      if (i) i.stock = Math.max(0, i.stock - l.qty);
    }
    addLog({ merchant: m.id, kind: "sale", text: `Sold ${list(lines)} for ${fmt(total)} sUSD (${invoiceId})` });
    emit({ t: "done" });

    // 6. Treasury: restock anything that ran low. Runs after the customer is done.
    restock(m).catch((e) => addLog({ merchant: m.id, kind: "info", text: `Restock check failed: ${String(e?.message ?? e)}` }));
    return session;
  } catch (e) {
    return fail(e instanceof ContractError ? `The contract refused: ${e.message}` : `Something went wrong: ${String((e as Error)?.message ?? e)}`);
  }
}

// ---------------------------------------------------------------- Merchant treasury

const restocking = new Set<string>();

/**
 * Procurement loop. For each item at or below its reorder point, the shop's agent asks the
 * supplier's agent for a quote, checks the unit cost against the owner's rule, and pays the
 * supplier's onchain invoice from the shop's revenue. The shop's own onchain limits apply.
 */
export async function restock(m: Merchant) {
  if (!m.supplier || restocking.has(m.id)) return;
  restocking.add(m.id);
  try {
    const supplier = getMerchant(m.supplier);
    for (const i of m.items.filter((x) => x.restockQty > 0 && x.stock <= x.reorderAt)) {
      const quoteUnit = i.unitCost; // the supplier agent quotes its list price
      const cap = Math.floor(i.unitCost * m.rules.maxCostMarkup);
      if (quoteUnit > cap) {
        addLog({ merchant: m.id, kind: "info", text: `Skipped restocking ${i.name}: quote ${fmt(quoteUnit)} is above the ${fmt(cap)} cap` });
        continue;
      }
      const total = quoteUnit * i.restockQty;
      addLog({ merchant: m.id, kind: "info", text: `${i.name} is down to ${i.stock}. Asked ${supplier.name} for ${i.restockQty} at ${fmt(quoteUnit)} each = ${fmt(total)} sUSD` });
      const id = newId("po");
      try {
        await agentCall(supplier.id, "create_invoice", {
          id, amount: String(total), kind: "Single", payer: m.id, expires_in_sec: 900,
          items_hash: crypto.createHash("sha256").update(`${i.sku}x${i.restockQty}`).digest("hex"),
        });
        const paid = await agentCall(m.id, "pay_invoice", { id });
        i.stock += i.restockQty;
        addLog({ merchant: m.id, kind: "restock", hash: paid.hash, text: `Paid ${supplier.name} ${fmt(total)} sUSD from revenue for ${i.restockQty} × ${i.name} (${id})` });
      } catch (e) {
        const reason = e instanceof ContractError ? e.message : String((e as Error)?.message ?? e);
        addLog({ merchant: m.id, kind: "refused", hash: e instanceof ContractError ? e.txHash : undefined, text: `Could not restock ${i.name}: ${reason}. The owner's limit stands.` });
      }
    }
  } finally {
    restocking.delete(m.id);
  }
}
