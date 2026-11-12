"""Subscriptions: a shop bills a person a fixed amount once per period.

The permission lives in the contract (`subscribe`), signed by the person, not their agent. Each
renewal is the same two-agent exchange as any sale: the shop's agent asks, the person's agent
checks the subscription and the balance, the shop's agent issues the bill onchain, and the
person's agent pays it. The contract refuses a bill that is early, for the wrong amount, or for
someone who has unsubscribed."""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app import accounts, fx, near, orders
from app.db import Order, Plan, Session, Shop, Subscription, log, utc
from app.policy import fmt

PERIODS = {"test": 300, "week": 7 * 86400, "month": 30 * 86400}
PERIOD_WORDS = {300: "every 5 minutes", 7 * 86400: "a week", 30 * 86400: "a month"}
_locks: dict[str, asyncio.Lock] = {}


def every(seconds: int) -> str:
    return PERIOD_WORDS.get(seconds, f"every {seconds // 86400} days")


async def start(customer, plan: Plan) -> Subscription:
    """The person subscribes: their own key writes the permission onchain, at today's dollar price."""
    amount = fx.to_micro(plan.price_kes)
    await near.refill_gas(customer.near_id)
    await near.call(customer.near_id, accounts.full_key(customer), "subscribe",
                    {"merchant": plan.shop_near_id, "plan": plan.id, "amount": str(amount), "period_ms": plan.period_sec * 1000},
                    deposit=near.ONE_YOCTO)
    sub = Subscription(id="s-" + secrets.token_hex(6), customer_near_id=customer.near_id, shop_near_id=plan.shop_near_id,
                       plan_id=plan.id, plan_name=plan.name, amount=amount, period_sec=plan.period_sec,
                       status="active", next_due=datetime.now(UTC))
    async with Session() as s:
        s.add(sub)
        await s.commit()
    return sub


async def stop(customer, sub: Subscription) -> None:
    try:
        await near.call(customer.near_id, accounts.full_key(customer), "unsubscribe",
                        {"merchant": sub.shop_near_id, "plan": sub.plan_id}, deposit=near.ONE_YOCTO)
    except near.ContractError as e:
        if "not subscribed" not in e.reason:
            raise
    await _set(sub.id, status="cancelled", note="You cancelled this.")


async def _set(sub_id: str, **fields) -> None:
    async with Session() as s:
        row = await s.get(Subscription, sub_id)
        for k, v in fields.items():
            setattr(row, k, v)
        await s.commit()


async def renew(sub_id: str) -> None:
    """One bill for one subscription, if it is due and the person's agent agrees to pay it."""
    async with _locks.setdefault(sub_id, asyncio.Lock()):
        async with Session() as s:
            sub = await s.get(Subscription, sub_id)
            shop = await s.get(Shop, sub.shop_near_id) if sub else None
        if sub is None or sub.status not in ("active", "needs_money") or utc(sub.next_due) > datetime.now(UTC):
            return
        customer, merchant = await accounts.by_near_id(sub.customer_near_id), await accounts.by_near_id(sub.shop_near_id)
        if shop is None or shop.status != "approved" or customer is None or merchant is None:
            return await _set(sub.id, next_due=datetime.now(UTC) + timedelta(hours=1), note="The shop isn't taking payments right now.")

        # The person's agent checks before any bill is issued.
        mandate, balance = await asyncio.gather(
            near.view("get_subscription", {"payer": sub.customer_near_id, "merchant": sub.shop_near_id, "plan": sub.plan_id}),
            near.view("get_balance", {"account_id": sub.customer_near_id}))
        if mandate is None or int(mandate["amount"]) != sub.amount:
            return await _set(sub.id, status="cancelled", note="This subscription is no longer on the contract.")
        if int(mandate["next_due_ms"]) > datetime.now(UTC).timestamp() * 1000:  # already paid for this period
            return await _set(sub.id, status="active", next_due=datetime.fromtimestamp(int(mandate["next_due_ms"]) / 1000, UTC))
        if int(balance) < sub.amount:
            if sub.status != "needs_money":
                await log(sub.shop_near_id, "info", f"{customer.name}'s agent could not pay {sub.plan_name} ({fmt(sub.amount)}): their balance is too low. It has asked them to add money.")
            return await _set(sub.id, status="needs_money", note=f"Your balance is below {fmt(sub.amount)}. Add money and your agent pays this straight away.")

        order = Order(id="o-" + secrets.token_hex(6), shop_near_id=sub.shop_near_id, customer_near_id=sub.customer_near_id,
                      party_size=1, goal=f"{sub.plan_name} subscription", mode="sub", agent_mode="Scripted rules", events=[])
        async with Session() as s:
            s.add(order)
            await s.commit()

        async def nobody(_: dict) -> None:  # no one is watching a renewal; the events are kept on the order
            pass

        run = orders.Run(order, nobody)
        me, them = f"{customer.name.split(' ')[0]}'s agent", f"{shop.name} agent"
        line = {"sku": sub.plan_id, "name": sub.plan_name, "qty": 1, "unit_price": sub.amount}
        await run.emit({"t": "msg", "from": "merchant", "who": them, "kind": "request", "text": f"{sub.plan_name} is due: {fmt(sub.amount)}, {every(sub.period_sec)}."})
        await run.emit({"t": "msg", "from": "personal", "who": me, "kind": "accept",
                        "text": "My customer is subscribed to this, for this amount, and it is due. Send the bill."})
        invoice_id = "sub-" + secrets.token_hex(5)
        try:
            made = await near.call(sub.shop_near_id, accounts.agent_key(merchant), "create_invoice", {
                "id": invoice_id, "amount": str(sub.amount), "items_hash": "sub:" + sub.plan_id, "kind": "Single",
                "payer": sub.customer_near_id, "expires_in_sec": 900})
            await run.emit({"t": "tx", "who": them, "label": "Invoice issued onchain", "hash": made.tx_hash})
            await run.save(invoice_id=invoice_id, kind="Single", total=sub.amount, lines=[line])
            paid = await near.call(sub.customer_near_id, accounts.agent_key(customer), "pay_invoice", {"id": invoice_id})
        except near.ContractError as e:
            # Most often the person's own limits. Try again in an hour rather than hammering the contract.
            await run.emit({"t": "refused", "reason": e.reason, "hash": e.tx_hash, "text": f"The contract refused the payment: {e.reason}."})
            await log(sub.shop_near_id, "refused", f"{sub.plan_name} for {customer.name} was refused onchain: {e.reason}", None)
            await run.finish("refused")
            return await _set(sub.id, next_due=datetime.now(UTC) + timedelta(hours=1),
                              note=f"The contract refused the last payment: {e.reason}. Your agent tries again in an hour.")
        await run.emit({"t": "tx", "who": me, "label": f"Paid {fmt(sub.amount)}", "hash": paid.tx_hash})
        await orders._paid(run, paid.value)
        after = await near.view("get_subscription", {"payer": sub.customer_near_id, "merchant": sub.shop_near_id, "plan": sub.plan_id})
        await _set(sub.id, status="active", note="", next_due=datetime.fromtimestamp(int(after["next_due_ms"]) / 1000, UTC))


async def run_due() -> None:
    """Called on a timer: bill every subscription that is due."""
    async with Session() as s:
        due = list(await s.scalars(select(Subscription.id).where(
            Subscription.status.in_(("active", "needs_money")), Subscription.next_due <= datetime.now(UTC))))
    for sub_id in due:
        try:
            await renew(sub_id)
        except Exception:  # one bad renewal must not stop the rest
            await _set(sub_id, next_due=datetime.now(UTC) + timedelta(minutes=10))
