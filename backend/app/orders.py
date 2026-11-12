"""One order from start to finish: connect, negotiate, invoice, pay, receipt.

This module wires the two agents together and keeps the record. It makes no decisions
about what to buy or what to charge: the agents and `policy` do that."""

import asyncio
import secrets

from sqlalchemy import select

from datetime import UTC, datetime

from app import accounts, fx, near, policy, presence, treasury
from app.agents import llm
from app.agents.a2a import Channel, Emit
from app.agents.merchant import Desk, make_merchant
from app.agents.personal import Checkout, run_personal
from sqlalchemy import func

from app.db import Account, Charge, Item, Order, Session, Shop, log
from app.policy import Line, fmt

_join_locks: dict[str, asyncio.Lock] = {}


def item_dict(i: Item) -> dict:
    # The owner's price is in shillings. What the contract charges is that, in dollars, at the current rate.
    kes = i.price_kes if i.price_kes is not None else round(fx.to_kes(i.price))
    return {"sku": i.sku, "name": i.name, "price": fx.to_micro(kes), "price_kes": kes, "tags": i.tags, "stock": i.stock,
            "reorder_at": i.reorder_at, "restock_qty": i.restock_qty, "unit_cost": i.unit_cost}


async def shop_items(shop_id: str) -> list[dict]:
    async with Session() as s:
        rows = await s.scalars(select(Item).where(Item.shop_near_id == shop_id).order_by(Item.id))
        return [item_dict(i) for i in rows]


async def names(near_ids: list[str]) -> dict[str, str]:
    async with Session() as s:
        rows = await s.scalars(select(Account).where(Account.near_id.in_(near_ids)))
        found = {a.near_id: a.name for a in rows}
    return {n: found.get(n, n.split(".")[0]) for n in near_ids}


class Run:
    """Collects an order's events, streams them, and saves them on the order row."""

    def __init__(self, order: Order, emit: Emit):
        self.order, self._emit = order, emit
        self.events: list[dict] = list(order.events or [])

    async def emit(self, e: dict) -> None:
        self.events.append(e)
        await self._emit(e)

    async def save(self, **fields) -> None:
        async with Session() as s:
            row = await s.get(Order, self.order.id)
            for k, v in fields.items():
                setattr(row, k, v)
                setattr(self.order, k, v)
            row.events = list(self.events)
            await s.commit()

    async def finish(self, status: str, error: str | None = None, **fields) -> Order:
        if error:
            await self.emit({"t": "error", "text": error})
        await self.emit({"t": "done", "order_id": self.order.id, "status": status})
        await self.save(status=status, **fields)
        return self.order


async def run_order(customer: Account, shop_id: str, goal: str, mode: str, presence_token: str | None,
                    party_size: int, emit: Emit, basket: list[dict] | None = None, charge_id: str | None = None,
                    approve=None) -> Order:
    """`basket` is set when the person picked exactly what to buy (gate tickets): no haggling, no LLM.
    `charge_id` is an amount the cashier keyed in at a counter: the same fast path, with one line."""
    order = Order(id="o-" + secrets.token_hex(6), shop_near_id=shop_id, customer_near_id=customer.near_id,
                  party_size=party_size, goal=goal, mode=mode, agent_mode=llm.mode_label(), events=[])
    async with Session() as s:
        s.add(order)
        await s.commit()
        shop = await s.get(Shop, shop_id)
        charge = await s.get(Charge, charge_id) if charge_id else None
        visits = await s.scalar(select(func.count()).select_from(Order).where(
            Order.shop_near_id == shop_id, Order.customer_near_id == customer.near_id, Order.status == "paid")) or 0
    run = Run(order, emit)
    try:
        # 1. Connect: check the shop against the onchain register before talking to it.
        if shop is None or not shop.listed or shop.status != "approved":
            return await run.finish("failed", "That shop is not on SokoniPay.")
        if shop.kind == "venue" and not basket:
            return await run.finish("failed", "Pick how many tickets you want.")
        if shop.kind == "counter":
            if charge is None or charge.shop_near_id != shop_id or charge.status != "open":
                return await run.finish("failed", "That amount is no longer waiting to be paid. Ask the cashier to enter it again.")
            async with Session() as s:  # one customer per amount: take it before paying
                row = await s.get(Charge, charge.id)
                if row.status != "open" or row.order_id:
                    return await run.finish("failed", "Someone is already paying that amount.")
                row.order_id = order.id
                await s.commit()
        if not await near.view("is_verified", {"account_id": shop_id}):
            return await run.finish("failed", f"{shop_id} is not a verified shop. Your agent did not connect.")
        await run.emit({"t": "status", "ok": True, "text": f"Verified shop: {shop_id}"})
        if mode == "table" and shop.rules.get("presence_for_table"):
            if not presence.verify(shop_id, presence_token):
                return await run.finish("failed", "That table code has expired. Scan the code on the shop's screen again.")
            await run.emit({"t": "status", "ok": True, "text": "You're at the shop: the code was accepted. No location was shared."})

        merchant_account = await accounts.by_near_id(shop_id)
        items = await shop_items(shop_id)
        if charge:
            sku = "sale-" + charge.id
            items = [{"sku": sku, "name": charge.note or "Counter sale", "price": fx.to_micro(charge.amount_kes), "price_kes": charge.amount_kes,
                      "tags": ["counter"], "stock": 1, "reorder_at": 0, "restock_qty": 0, "unit_cost": 0}]
            basket = [{"sku": sku, "qty": 1}]
        me, them = f"{customer.name.split(' ')[0]}'s agent", f"{shop.name} agent"

        # 2-3. Two separate agents, one channel between them.
        desk = Desk(shop_id, shop.name, shop.rules or {}, items, accounts.agent_key(merchant_account), customer.near_id,
                    party_size > 1, shop.hours, party_size, visits, fixed=basket is not None)
        channel = Channel(me, them, make_merchant(desk, fixed_prices=basket is not None).handle, run.emit)
        checkout = Checkout(customer.near_id, accounts.agent_key(customer), shop_id, party_size, me, run.emit, approve)
        limits, balance = await asyncio.gather(
            near.view("get_limits", {"account_id": customer.near_id}), near.view("get_balance", {"account_id": customer.near_id}))
        out = await run_personal(goal, party_size, items, channel, checkout, customer.name, limits, int(balance), run.emit, basket)

        inv = out.invoice
        if inv:
            await run.save(invoice_id=inv["invoice_id"], kind=inv["kind"], total=inv["total"], lines=inv["lines"])
        if charge and not (inv and out.status == "paid"):
            await _release(charge)  # not paid: the amount goes back to waiting
        if out.status == "refused":
            await log(shop_id, "refused", f"Payment for {inv['invoice_id']} was refused onchain: {out.reason}", None)
            return await run.finish("refused")
        if out.status == "failed":
            gone = policy.sold_out_named(items, goal) if not inv else []
            if gone:
                return await run.finish("failed", f"{' and '.join(gone)} {'is' if len(gone) == 1 else 'are'} sold out right now, "
                                                  "so nothing was ordered or paid. Pick something else from the menu.")
            return await run.finish("failed", out.reason or "Your agent could not complete the order.")

        # 4. Split bills wait for the others to open the link and pay their share.
        onchain = await near.view("get_invoice", {"id": inv["invoice_id"]})
        if onchain["status"] == "Paid":
            if charge:
                async with Session() as s:
                    row = await s.get(Charge, charge.id)
                    row.status = "paid"
                    await s.commit()
            return await _paid(run, onchain)
        await run.emit(await _collecting_event(order, onchain))
        return await run.finish("collecting")
    except near.ContractError as e:
        await _release(charge)
        return await run.finish("failed", f"The contract refused: {e.reason}.")
    except Exception as e:  # the stream must always end with a clear message
        await _release(charge)
        return await run.finish("failed", f"Something went wrong ({type(e).__name__}). Nothing more was paid.")


async def _release(charge: Charge | None) -> None:
    """A counter amount whose payment didn't complete can be paid by the next try."""
    if charge is None:
        return
    async with Session() as s:
        row = await s.get(Charge, charge.id)
        if row.status == "open":
            row.order_id = None
            await s.commit()


async def _contribute(run: Run, payer: Account) -> str:
    """One more person's agent pays its share of a group invoice. Returns paid | collecting | refused."""
    order = run.order
    onchain = await near.view("get_invoice", {"id": order.invoice_id})
    amount = policy.share_of(order.total, order.party_size, len(onchain["contributions"]))
    amount = min(amount, int(onchain["amount"]) - int(onchain["funded"]))
    who = f"{payer.name.split(' ')[0]}'s agent"
    try:
        sent = await near.call(payer.near_id, accounts.agent_key(payer), "contribute", {"id": order.invoice_id, "amount": str(amount)})
    except near.ContractError as e:
        await run.emit({"t": "refused", "reason": e.reason, "hash": e.tx_hash,
                        "text": f"The contract refused {who}'s share: {e.reason}. Shares already paid stay in escrow and are refunded if the invoice expires."})
        return "refused"
    await run.emit({"t": "tx", "who": who, "label": f"Paid a {fmt(amount)} share into escrow", "hash": sent.tx_hash})
    return "paid" if sent.value["status"] == "Paid" else "collecting"


async def _collecting_event(order: Order, onchain: dict) -> dict:
    who = await names([c["account_id"] for c in onchain["contributions"]])
    return {"t": "collecting", "order_id": order.id, "invoice_id": order.invoice_id, "total": order.total,
            "party_size": order.party_size, "funded": int(onchain["funded"]),
            "paid": [{"id": c["account_id"], "name": who[c["account_id"]], "amount": int(c["amount"])} for c in onchain["contributions"]]}


async def _paid(run: Run, onchain: dict) -> Order:
    """The invoice is settled: print the receipt, take the stock, tell the shop, check for restocking."""
    order = run.order
    who = await names([c["account_id"] for c in onchain["contributions"]])
    pay_tx = next((e["hash"] for e in reversed(run.events) if e["t"] == "tx" and e["label"].startswith("Paid")), None)
    ticket = None
    if order.kind == "Ticket":
        # The Merchant Agent hands over the ticket it issued with the invoice.
        ticket = await near.view("get_ticket", {"id": order.invoice_id})
        async with Session() as s:
            shop = await s.get(Shop, order.shop_near_id)
        gate = policy.gate_now(shop.hours if shop else None)
        people = "one person" if ticket["admits"] == 1 else f"{ticket['admits']} people"
        await run.emit({"t": "msg", "from": "merchant", "who": f"{shop.name if shop else 'Shop'} agent", "kind": "ticket",
                        "text": f"Payment received. Here is your ticket: it admits {people}. {gate.says} Show it at the gate."})
    await run.emit({"t": "receipt", "id": order.invoice_id, "total": order.total, "kind": order.kind, "lines": order.lines, "tx_hash": pay_tx,
                    "ticket": ticket,
                    "payers": [{"id": c["account_id"], "name": who[c["account_id"]], "amount": int(c["amount"])} for c in onchain["contributions"]]})
    lines = [Line(**line) for line in order.lines or []]
    async with Session() as s:
        for line in lines:
            item = await s.scalar(select(Item).where(Item.shop_near_id == order.shop_near_id, Item.sku == line.sku))
            if item:
                item.stock = max(0, item.stock - line.qty)
        await s.commit()
    await log(order.shop_near_id, "sale", f"Sold {policy.listing(lines)} for {fmt(order.total)} ({order.invoice_id})", pay_tx)
    # Keep how the contract divided this sale, for the day's statement.
    merchant = await near.view("get_merchant", {"account_id": order.shop_near_id})
    shares = [{"account_id": x["account_id"], "amount": order.total * x["bps"] // 10_000} for x in (merchant or {}).get("splits", [])]
    shares = [x for x in shares if x["amount"] > 0]
    done = await run.finish("paid", paid_at=datetime.now(UTC), settled={
        "rate": fx.rate(), "kept": order.total - sum(x["amount"] for x in shares), "shares": shares})
    treasury.restock_soon(order.shop_near_id)
    return done


async def join_order(order_id: str, payer: Account, emit: Emit) -> Order | None:
    """Someone opens a split-bill link and their agent pays their share."""
    async with _join_locks.setdefault(order_id, asyncio.Lock()):
        async with Session() as s:
            order = await s.get(Order, order_id)
        if order is None:
            return None
        run = Run(order, emit)
        if order.status != "collecting":
            await emit({"t": "error", "text": "This bill is already settled." if order.status == "paid" else "This bill is no longer open."})
            await emit({"t": "done", "order_id": order.id, "status": order.status})
            return order
        onchain = await near.view("get_invoice", {"id": order.invoice_id})
        if any(c["account_id"] == payer.near_id for c in onchain["contributions"]):
            await emit({"t": "error", "text": "You've already paid your share of this bill."})
            await emit({"t": "done", "order_id": order.id, "status": order.status})
            return order
        status = await _contribute(run, payer)
        onchain = await near.view("get_invoice", {"id": order.invoice_id})
        if onchain["status"] == "Paid":
            return await _paid(run, onchain)
        await run.emit(await _collecting_event(order, onchain))
        await run.emit({"t": "done", "order_id": order.id, "status": "collecting" if status != "refused" else "refused"})
        await run.save()
        return order
