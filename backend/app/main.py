"""SokoniPay API."""

import asyncio
import json
import time
from contextlib import asynccontextmanager

import httpx

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

import secrets

from datetime import UTC, date, datetime, time as clock, timedelta
from zoneinfo import ZoneInfo

from app import accounts, chat, fx, intents, near, orders, policy, presence, subs, voice
from app.agents import llm
from app.auth import User, current_user
from app.config import settings
from app.db import Account, AgentLog, Charge, Deposit, Item, Order, Plan, Session, Shop, Subscription, init_db, log, ms, utc


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    await fx.refresh()
    # Items priced before shilling pricing: fix their shilling price once, at today's rate.
    async with Session() as s:
        for item in await s.scalars(select(Item).where(Item.price_kes.is_(None))):
            item.price_kes = max(1, round(fx.to_kes(item.price)))
        await s.commit()

    async def keep_rate() -> None:
        while True:
            await asyncio.sleep(1800)
            await fx.refresh()

    async def bill_subscriptions() -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await subs.run_due()
            except Exception:
                pass  # the next tick tries again

    tasks = [asyncio.create_task(keep_rate()), asyncio.create_task(bill_subscriptions())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="SokoniPay", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)


# ---------------------------------------------------------------- helpers


_paying: set[str] = set()


def sse(run, busy_key: str | None = None) -> StreamingResponse:
    """Run `run(emit)` in the background and stream what it emits. The work finishes even if the reader leaves.

    `busy_key` allows one run at a time per person, so two taps on "pay" can never become two payments."""
    if busy_key:
        if busy_key in _paying:
            raise HTTPException(409, "Your agent is already working on an order. Wait for it to finish.")
        _paying.add(busy_key)
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def emit(e: dict) -> None:
        await queue.put(e)

    async def work() -> None:
        try:
            await run(emit)
        finally:
            _paying.discard(busy_key)
            await queue.put(None)

    task = asyncio.create_task(work())

    async def stream():
        _keep = task  # hold a reference so the task is not collected mid-run
        while (e := await queue.get()) is not None:
            yield f"data: {json.dumps(e)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


async def customer_of(user: User = Depends(current_user)) -> Account:
    account = await accounts.get(user.id, "customer")
    if account is None or not account.ready:
        raise HTTPException(409, "Finish setting up your account first.")
    return account


async def merchant_of(user: User = Depends(current_user), x_shop: str | None = Header(default=None)) -> Account:
    """The shop this request is about: the one named in the X-Shop header, or the person's first."""
    mine = [a for a in await accounts.shops_of(user.id) if a.ready]
    account = next((a for a in mine if a.near_id == x_shop), None) if x_shop else (mine[0] if mine else None)
    if account is None:
        raise HTTPException(409, "Open your shop first." if not mine else "That shop isn't yours.")
    return account


async def admin_of(user: User = Depends(current_user)) -> User:
    if (user.email or "").lower() not in settings.admins:
        raise HTTPException(403, "This page is for SokoniPay admins.")
    return user


def ticket_view(t: dict | None) -> dict | None:
    """A ticket's entry rights plus its state: valid, used or expired.

    The closing time is the one written on the ticket onchain when it was sold. Every screen reads that,
    so a later change to the venue's hours never makes two screens disagree about one ticket."""
    if t is None:
        return None
    expired = bool(t["valid_until_ms"]) and time.time() * 1000 > t["valid_until_ms"]
    state = "used" if t["admitted"] >= t["admits"] else "expired" if expired else "valid"
    return {**t, "state": state}


def public(a: Account | None) -> dict | None:
    return a and {"near_id": a.near_id, "name": a.name, "role": a.role, "ready": a.ready}


def setup_error(e: near.ContractError) -> HTTPException:
    return HTTPException(502, f"NEAR testnet did not complete the setup ({e.reason}). Try again: it picks up where it stopped.")


async def receipts_for(near_id: str) -> list[dict]:
    invoices = await near.view("get_invoices_for", {"account_id": near_id, "limit": 30})
    async with Session() as s:
        shops = {x.near_id: x.name for x in await s.scalars(select(Shop))}
        renewals = {o.invoice_id: o.goal for o in await s.scalars(
            select(Order).where(Order.customer_near_id == near_id, Order.mode == "sub", Order.invoice_id.is_not(None)))}
        back = {o.invoice_id: o.refunded_at for o in await s.scalars(
            select(Order).where(Order.customer_near_id == near_id, Order.refunded_at.is_not(None)))}
        pickups = set(await s.scalars(select(Order.invoice_id).where(
            Order.customer_near_id == near_id, Order.mode == "counter", Order.invoice_id.is_not(None))))
    paid = [i for i in invoices if i["merchant"] != near_id
            and (i["status"] == "Paid" or (i["status"] == "Refunded" and i["paid_at_ms"]))]
    tickets = await asyncio.gather(*(near.view("get_ticket", {"id": i["id"]}) if i["kind"] == "Ticket" else asyncio.sleep(0) for i in paid))
    return [{"id": i["id"], "shop": shops.get(i["merchant"], i["merchant"]), "kind": i["kind"], "status": i["status"],
             "total": int(i["amount"]), "paid_at_ms": i["paid_at_ms"], "redeemed": i["redeemed"],
             "refunded_at_ms": ms(back[i["id"]]) if back.get(i["id"]) else None,
             "subscription": renewals.get(i["id"]),
             "pickup_code": policy.pickup_code(i["id"]) if i["id"] in pickups else None,
             "ticket": ticket_view(t) if i["kind"] == "Ticket" else None,
             "my_share": next((int(c["amount"]) for c in i["contributions"] if c["account_id"] == near_id), None)}
            for i, t in zip(paid, tickets, strict=True)]


# ---------------------------------------------------------------- public


@app.get("/api/health")
async def health():
    return {"ok": True, "contract": settings.contract_id, "token": settings.token_id, "agents": llm.mode_label(),
            "explorer_tx": settings.explorer_tx, "kes_per_usd": fx.rate()}


@app.get("/api/shops")
async def list_shops():
    async with Session() as s:
        shops = list(await s.scalars(select(Shop).where(Shop.listed, Shop.status == "approved").order_by(Shop.created_at)))
    verified = await asyncio.gather(*(near.view("is_verified", {"account_id": x.near_id}) for x in shops))
    return [{"near_id": x.near_id, "name": x.name, "blurb": x.blurb, "place": x.place, "verified": bool(v),
             "kind": x.kind, "open": policy.gate_now(x.hours).open if x.kind == "venue" else True}
            for x, v in zip(shops, verified, strict=True)]


@app.get("/api/shops/{near_id}")
async def get_shop(near_id: str):
    async with Session() as s:
        shop = await s.get(Shop, near_id)
    if shop is None or not shop.listed or shop.status != "approved":
        raise HTTPException(404, "That shop is not on SokoniPay.")
    items = await orders.shop_items(near_id)
    gate = policy.gate_now(shop.hours)
    return {"near_id": shop.near_id, "name": shop.name, "blurb": shop.blurb, "place": shop.place,
            "kind": shop.kind, "hours": shop.hours, "open": gate.open, "gate_says": gate.says,
            # A ticket sold while the venue is closed is for its next opening: "today" or "tomorrow".
            "ticket_day": gate.ticket_day, "ticket_says": gate.ticket_says,
            "hours_line": policy.hours_line(shop.hours),
            # That a discount exists and for whom, so a customer's agent knows to ask. Never how much.
            "discounts_for": sorted({policy.describe_rule(r) for r in policy.discount_rules(shop.rules or {})}),
            "verified": bool(await near.view("is_verified", {"account_id": near_id})),
            "items": [{**{k: i[k] for k in ("sku", "name", "price", "price_kes", "tags", "stock")},
                       "unit": policy.unit_of(i), "whole": policy.sold_whole(i)} for i in items],
            "charges": await open_charges(near_id) if shop.kind == "counter" else [],
            "plans": await plans_of(near_id)}


def plan_view(p: Plan) -> dict:
    return {"id": p.id, "name": p.name, "price_kes": p.price_kes, "price": fx.to_micro(p.price_kes), "every": subs.every(p.period_sec)}


async def plans_of(shop_id: str) -> list[dict]:
    async with Session() as s:
        return [plan_view(p) for p in await s.scalars(select(Plan).where(Plan.shop_near_id == shop_id, Plan.active).order_by(Plan.price_kes))]


@app.get("/api/shops/{near_id}/buys")
async def what_it_buys(near_id: str, amount_kes: int, sku: str | None = None, note: str = ""):
    """What an amount of money buys at a counter, from the shop's own price list. Nothing is ordered."""
    if not 1 <= amount_kes <= 1_000_000:
        raise HTTPException(422, "Enter an amount in shillings.")
    items = await orders.shop_items(near_id)
    b = policy.amount_buys(next((i for i in items if i["sku"] == sku), None), amount_kes, note)
    return {"ok": b.ok, "says": b.says, "what": b.what, "charge_kes": b.charge_kes, "charge": fx.to_micro(b.charge_kes)}


CHARGE_LIFE = timedelta(minutes=10)


async def open_charges(shop_id: str) -> list[dict]:
    """Amounts waiting to be paid at a counter. One that nobody pays within ten minutes lapses."""
    async with Session() as s:
        rows = await s.scalars(select(Charge).where(Charge.shop_near_id == shop_id, Charge.status == "open",
                                                    Charge.created_at > datetime.now(UTC) - CHARGE_LIFE).order_by(Charge.created_at.desc()))
        return [{"id": c.id, "amount": fx.to_micro(c.amount_kes), "amount_kes": c.amount_kes, "note": c.note,
                 "at": c.created_at.isoformat(), "taken": bool(c.order_id)} for c in rows]


@app.get("/api/shops/{near_id}/visits")
async def my_visits(near_id: str, account: Account = Depends(customer_of)):
    """How often the signed-in person has paid this shop."""
    async with Session() as s:
        n = await s.scalar(select(func.count()).select_from(Order).where(
            Order.shop_near_id == near_id, Order.customer_near_id == account.near_id, Order.status == "paid"))
    return {"times": n or 0}


@app.get("/api/receipts/{invoice_id}")
async def receipt(invoice_id: str):
    """Read from the contract, so anyone with the link can check it."""
    inv = await near.view("get_invoice", {"id": invoice_id})
    if inv is None:
        raise HTTPException(404, "There is no ticket or receipt with that number.")
    async with Session() as s:
        order = await s.scalar(select(Order).where(Order.invoice_id == invoice_id))
        shop = await s.get(Shop, inv["merchant"])
    who = await orders.names([c["account_id"] for c in inv["contributions"]])
    tx = next((e["hash"] for e in reversed((order.events if order else None) or []) if e["t"] == "tx" and e["label"].startswith("Paid")), None)
    ticket = await near.view("get_ticket", {"id": invoice_id}) if inv["kind"] == "Ticket" else None
    return {"id": inv["id"], "shop": shop.name if shop else inv["merchant"], "shop_id": inv["merchant"], "kind": inv["kind"],
            "status": inv["status"], "total": int(inv["amount"]), "paid_at_ms": inv["paid_at_ms"], "redeemed": inv["redeemed"],
            "ticket": ticket_view(ticket), "pickup_code": policy.pickup_code(inv["id"]) if order and order.mode == "counter" else None,
            "lines": order.lines if order else None, "tx_hash": tx,
            "payers": [{"id": c["account_id"], "name": who[c["account_id"]], "amount": int(c["amount"])} for c in inv["contributions"]]}


@app.get("/api/orders/{order_id}")
async def order_summary(order_id: str):
    """What a friend sees when they open a split-bill link."""
    async with Session() as s:
        order = await s.get(Order, order_id)
        shop = await s.get(Shop, order.shop_near_id) if order else None
    if order is None or not order.invoice_id:
        raise HTTPException(404, "That bill doesn't exist.")
    inv = await near.view("get_invoice", {"id": order.invoice_id})
    who = await orders.names([c["account_id"] for c in inv["contributions"]] + [order.customer_near_id])
    from app.policy import share_of
    return {"order_id": order.id, "invoice_id": order.invoice_id, "shop": shop.name if shop else order.shop_near_id,
            "organiser": who[order.customer_near_id], "total": order.total, "party_size": order.party_size, "lines": order.lines,
            "status": "paid" if inv["status"] == "Paid" else "expired" if inv["status"] == "Refunded" else order.status,
            "funded": int(inv["funded"]), "share": share_of(order.total, order.party_size, len(inv["contributions"])),
            "paid": [{"id": c["account_id"], "name": who[c["account_id"]], "amount": int(c["amount"])} for c in inv["contributions"]]}


# ---------------------------------------------------------------- signed-in: both apps


@app.get("/api/me")
async def me(user: User = Depends(current_user)):
    return {"user": {"name": user.name, "email": user.email}, "is_admin": (user.email or "").lower() in settings.admins,
            "customer": public(await accounts.get(user.id, "customer")),
            "merchant": public(await accounts.get(user.id, "merchant")),
            "shops": await my_shops(user)}


async def my_shops(user: User) -> list[dict]:
    mine = await accounts.shops_of(user.id)
    async with Session() as s:
        rows = {x.near_id: x for x in await s.scalars(select(Shop).where(Shop.near_id.in_([a.near_id for a in mine])))}
    return [{"near_id": a.near_id, "name": a.name, "ready": a.ready, "kind": rows[a.near_id].kind if a.near_id in rows else "food",
             "status": rows[a.near_id].status if a.near_id in rows else "pending"} for a in mine]


# ---------------------------------------------------------------- customer app


@app.post("/api/me/customer")
async def setup_customer(user: User = Depends(current_user)):
    try:
        return public(await accounts.setup_customer(user))
    except near.ContractError as e:
        raise setup_error(e) from e


@app.get("/api/wallet")
async def wallet(account: Account = Depends(customer_of)):
    balance, limits, receipts = await asyncio.gather(
        near.view("get_balance", {"account_id": account.near_id}),
        near.view("get_limits", {"account_id": account.near_id}),
        receipts_for(account.near_id))
    async with Session() as s:
        used = (await s.execute(select(Order.shop_near_id, func.count(), func.max(Order.created_at))
                                .where(Order.customer_near_id == account.near_id, Order.status.in_(("paid", "refunded")))
                                .group_by(Order.shop_near_id))).all()
        added = list(await s.scalars(select(Deposit).where(Deposit.customer_near_id == account.near_id, Deposit.credited > 0)
                                     .order_by(Deposit.created_at.desc()).limit(30)))
    lim = limits and {k: int(limits[k]) for k in ("per_payment", "per_day", "spent_in_window")}
    typed = account.limits_kes or {}
    if lim and typed.get("micro") == [lim["per_payment"], lim["per_day"]]:
        lim |= {"per_payment_kes": typed["per_payment"], "per_day_kes": typed["per_day"]}  # as the person typed them
    return {"near_id": account.near_id, "name": account.name, "balance": int(balance), "receipts": receipts,
            # Shops this person pays most and most recently, so the app can list them first.
            "added": [{"id": d.id, "amount": d.credited, "at_ms": ms(d.created_at), "symbol": d.symbol,
                       "chain": intents.CHAINS.get(d.chain, d.chain.title()), "demo": d.mode != "live", "out": d.mode == "out"} for d in added],
            "shops_used": [{"near_id": shop, "times": n, "last": last.isoformat()} for shop, n, last in used],
            "limits": lim}


class LimitsIn(BaseModel):
    per_payment: int = Field(gt=0, le=10_000_000_000)
    per_day: int = Field(gt=0, le=10_000_000_000)
    # The same limits in whole shillings, as typed. Kept only to show them back unchanged.
    per_payment_kes: int | None = Field(default=None, gt=0, le=2_000_000_000)
    per_day_kes: int | None = Field(default=None, gt=0, le=2_000_000_000)


@app.post("/api/wallet/limits")
async def change_limits(body: LimitsIn, account: Account = Depends(customer_of)):
    """The person changes their own limits. Signed with their full key: the agent's key can't do this."""
    if body.per_payment > body.per_day:
        raise HTTPException(422, "The per-payment limit can't be higher than the daily limit.")
    try:
        sent = await near.set_limits(account.near_id, accounts.full_key(account), body.per_payment, body.per_day)
    except near.ContractError as e:
        raise HTTPException(502, f"NEAR did not accept the change: {e.reason}.") from e
    async with Session() as s:
        row = await s.get(Account, account.id)
        row.limits_kes = ({"per_payment": body.per_payment_kes, "per_day": body.per_day_kes, "micro": [body.per_payment, body.per_day]}
                          if body.per_payment_kes and body.per_day_kes else None)
        await s.commit()
    return {"ok": True, "tx_hash": sent.tx_hash}


# ---- subscriptions


class SubscribeIn(BaseModel):
    plan_id: str = Field(min_length=3, max_length=20)


def sub_view(x: Subscription, shop_name: str) -> dict:
    return {"id": x.id, "shop": shop_name, "shop_id": x.shop_near_id, "plan": x.plan_name, "amount": x.amount,
            "every": subs.every(x.period_sec), "status": x.status, "note": x.note, "next_due_ms": ms(x.next_due)}


@app.get("/api/subscriptions")
async def my_subscriptions(account: Account = Depends(customer_of)):
    async with Session() as s:
        rows = list(await s.scalars(select(Subscription).where(Subscription.customer_near_id == account.near_id).order_by(Subscription.created_at.desc())))
        names = {x.near_id: x.name for x in await s.scalars(select(Shop))}
        bills = list(await s.scalars(select(Order).where(Order.customer_near_id == account.near_id, Order.mode == "sub",
                                                         Order.status.in_(("paid", "refunded"))).order_by(Order.created_at.desc()).limit(60)))
    return [{**sub_view(x, names.get(x.shop_near_id, x.shop_near_id)),
             "payments": [{"id": o.invoice_id, "at": (o.paid_at or o.created_at).isoformat(), "total": o.total, "refunded": o.status == "refunded"}
                          for o in bills if o.shop_near_id == x.shop_near_id and (o.lines or [{}])[0].get("sku") == x.plan_id][:6]}
            for x in rows]


@app.post("/api/subscriptions")
async def subscribe(body: SubscribeIn, account: Account = Depends(customer_of)):
    """Subscribe to a shop's plan. Signed with the person's full key: their agent can't subscribe them to anything."""
    async with Session() as s:
        plan = await s.get(Plan, body.plan_id)
        shop = await s.get(Shop, plan.shop_near_id) if plan else None
        have = plan and await s.scalar(select(Subscription).where(
            Subscription.customer_near_id == account.near_id, Subscription.plan_id == plan.id, Subscription.status != "cancelled"))
    if plan is None or not plan.active or shop is None or shop.status != "approved":
        raise HTTPException(404, "That plan isn't offered any more.")
    if have:
        raise HTTPException(409, "You already have this subscription.")
    try:
        made = await subs.start(account, plan)
    except near.ContractError as e:
        raise HTTPException(502, f"NEAR did not accept the subscription: {e.reason}.") from e
    await log(shop.near_id, "info", f"{account.name} subscribed to {plan.name} ({policy.fmt(made.amount)} {subs.every(plan.period_sec)}).")
    asyncio.create_task(subs.renew(made.id))  # the first bill is due straight away
    return sub_view(made, shop.name)


@app.post("/api/subscriptions/{sub_id}/{action}")
async def change_subscription(sub_id: str, action: str, account: Account = Depends(customer_of)):
    """Pause, resume or cancel. While paused the person's agent refuses the shop's bills."""
    async with Session() as s:
        x = await s.get(Subscription, sub_id)
    if x is None or x.customer_near_id != account.near_id or x.status == "cancelled" or action not in ("pause", "resume", "cancel"):
        raise HTTPException(404, "That subscription isn't yours to change.")
    if action == "cancel":
        try:
            await subs.stop(account, x)
        except near.ContractError as e:
            raise HTTPException(502, f"NEAR did not complete that: {e.reason}.") from e
        await log(x.shop_near_id, "info", f"{account.name} cancelled {x.plan_name}.")
    elif action == "pause":
        await subs._set(x.id, status="paused", note="Paused. Your agent refuses bills for this until you resume.")
    else:
        await subs._set(x.id, status="active", note="")
        asyncio.create_task(subs.renew(x.id))
    return {"ok": True}


# ---- chat with your own agent


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    thread: str | None = Field(default=None, max_length=20)  # none starts a new chat


class ConfirmIn(BaseModel):
    yes: bool


@app.get("/api/chats")
async def chat_list(account: Account = Depends(customer_of)):
    """The person's conversations with their agent, newest first."""
    return {"chats": await chat.threads(account.near_id), "agent": llm.mode_label(), "voice": voice.enabled()}


@app.get("/api/chats/{thread_id}")
async def chat_history(thread_id: str, account: Account = Depends(customer_of)):
    return {"messages": await chat.history(account.near_id, thread_id)}


@app.delete("/api/chats/{thread_id}")
async def chat_delete(thread_id: str, account: Account = Depends(customer_of)):
    if not await chat.remove(account.near_id, thread_id):
        raise HTTPException(404, "That chat isn't yours.")
    return {"ok": True}


@app.post("/api/chat")
async def chat_turn(body: ChatIn, account: Account = Depends(customer_of)):
    """Say something to your agent. If it finds something to buy, it stops and asks before paying."""
    return sse(lambda emit: chat.run(account, body.text.strip(), body.thread, emit), busy_key=account.near_id)


@app.post("/api/chat/confirm")
async def chat_confirm(body: ConfirmIn, account: Account = Depends(customer_of)):
    """The person's yes or no to the total their agent is showing them."""
    if not chat.answer(account.near_id, body.yes):
        raise HTTPException(409, "There is nothing waiting for your answer. It may have timed out.")
    return {"ok": True}


# ---- voice: speak to the agent, hear it answer


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@app.post("/api/voice/transcribe")
async def voice_in(file: UploadFile, _: User = Depends(current_user)):
    """Turn a short recording into the text of a chat message. Nothing is sent to the agent here."""
    if not voice.enabled():
        raise HTTPException(404, "Voice isn't switched on.")
    audio = await file.read(voice.MAX_AUDIO + 1)
    if len(audio) > voice.MAX_AUDIO:
        raise HTTPException(413, "That recording is too long. Keep it under about 30 seconds.")
    if len(audio) < 800:
        raise HTTPException(422, "Nothing was recorded. Hold on a moment longer while you speak.")
    try:
        text = await voice.transcribe(audio, file.content_type or "")
    except voice.VoiceError as e:
        raise HTTPException(502, str(e)) from e
    if not text:
        raise HTTPException(422, "No words were heard. Try again a little closer to the microphone.")
    return {"text": text[:600]}


@app.post("/api/voice/speak")
async def voice_out(body: SpeakIn, _: User = Depends(current_user)):
    """Read a reply aloud. Only the first few sentences: long replies are for reading."""
    if not voice.enabled():
        raise HTTPException(404, "Voice isn't switched on.")
    stream = voice.speak(body.text)
    try:
        first = await anext(stream)  # fail with a proper error before any audio is sent
    except (voice.VoiceError, httpx.HTTPError, StopAsyncIteration) as e:
        raise HTTPException(502, "The voice service isn't answering. The reply is in the chat.") from e

    async def audio():
        yield first
        async for chunk in stream:
            yield chunk

    return StreamingResponse(audio(), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


# ---- adding money: any stablecoin, any chain, through NEAR Intents

_credit_locks: dict[str, asyncio.Lock] = {}


class FundingIn(BaseModel):
    asset_id: str = Field(min_length=3, max_length=200)
    amount: int = Field(ge=settings.funding_min, le=settings.funding_max)  # micro USD
    # Where NEAR Intents returns the coins if the swap fails. Giving it asks for a real deposit address.
    refund_to: str | None = Field(default=None, min_length=2, max_length=120)


def deposit_view(d: Deposit) -> dict:
    return {"id": d.id, "mode": d.mode, "chain": intents.CHAINS.get(d.chain, d.chain.title()), "symbol": d.symbol, "send": d.send,
            "expected": d.expected, "seconds": d.seconds, "deposit_address": d.deposit_address, "memo": d.memo,
            "deadline": d.deadline, "status": d.status, "credited": d.credited, "tx_hash": d.tx_hash}


async def _credit(deposit_id: str, account: Account, amount: int) -> Deposit:
    """Add the money to the SokoniPay balance, once."""
    async with _credit_locks.setdefault(deposit_id, asyncio.Lock()):
        async with Session() as s:
            d = await s.get(Deposit, deposit_id)
            if d.credited:
                return d
        await near.refill_gas(account.near_id)
        sent = await near.fund_susd(account.near_id, accounts.full_key(account), amount)
        async with Session() as s:
            d = await s.get(Deposit, deposit_id)
            d.status, d.credited, d.tx_hash = "done", amount, sent.tx_hash
            await s.commit()
            return d


@app.get("/api/funding/options")
async def funding_options(_: User = Depends(current_user)):
    """Chains, with the stablecoins NEAR Intents accepts on each."""
    try:
        return {"chains": await intents.chains(), "live": bool(settings.intents_treasury),
                "min": settings.funding_min, "max": settings.funding_max}
    except intents.IntentsError as e:
        raise HTTPException(502, str(e)) from e


@app.post("/api/funding/quote")
async def funding_quote(body: FundingIn, _: Account = Depends(customer_of)):
    """A live price from NEAR Intents. Nothing is committed and nothing moves."""
    try:
        return await intents.quote(body.asset_id, body.amount)
    except intents.IntentsError as e:
        raise HTTPException(422, str(e)) from e


class PayoutIn(BaseModel):
    asset_id: str = Field(min_length=3, max_length=200)
    amount: int = Field(ge=settings.funding_min, le=1_000_000_000)  # micro sUSD leaving the balance
    # Where the coins would go on the chosen chain. Asked for only when the withdrawal is made.
    address: str | None = Field(default=None, min_length=4, max_length=120)


@app.post("/api/funding/payout-quote")
async def payout_quote(body: PayoutIn, _: User = Depends(current_user)):
    """A live price from NEAR Intents for taking money out as a chosen coin on a chosen chain."""
    try:
        return await intents.payout_quote(body.asset_id, body.amount)
    except intents.IntentsError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/api/funding/withdrawals")
async def withdraw(body: PayoutIn, account: Account = Depends(customer_of)):
    """Take money out. The contract releases the sUSD (signed with the person's full key: the agent's key can't
    withdraw). On testnet that is where it stops: the quote is real, but no coins are sent on the other chain."""
    if not body.address:
        raise HTTPException(422, "Add the address the coins should go to.")
    if body.amount > int(await near.view("get_balance", {"account_id": account.near_id})):
        raise HTTPException(422, "That is more than your balance.")
    try:
        q = await intents.payout_quote(body.asset_id, body.amount)
    except intents.IntentsError as e:
        raise HTTPException(422, str(e)) from e
    try:
        await near.refill_gas(account.near_id)
        sent = await near.withdraw(account.near_id, accounts.full_key(account), body.amount)
    except near.ContractError as e:
        raise HTTPException(502, f"NEAR did not complete the withdrawal: {e.reason}.") from e
    if sent.value is False:  # the token transfer failed and the contract put the money back
        raise HTTPException(502, "The withdrawal didn't go through. Your balance is unchanged.")
    d = Deposit(id="w-" + secrets.token_hex(6), customer_near_id=account.near_id, mode="out", chain=q["chain"], symbol=q["symbol"],
                asset_id=body.asset_id, send=q["receive"], expected=body.amount, seconds=q["seconds"],
                deposit_address=body.address.strip(), status="done", credited=body.amount, tx_hash=sent.tx_hash)
    async with Session() as s:
        s.add(d)
        await s.commit()
    return deposit_view(d)


@app.post("/api/funding/deposits")
async def start_deposit(body: FundingIn, account: Account = Depends(customer_of)):
    """With `refund_to`: a real deposit address on the chosen chain. Without: a preview that moves nothing."""
    live = body.refund_to is not None
    if not live and int(await near.view("get_balance", {"account_id": account.near_id})) >= 100_000_000:
        raise HTTPException(409, "You already have 100 sUSD or more of demo money.")
    try:
        q = await intents.quote(body.asset_id, body.amount, body.refund_to.strip() if live else None)
    except intents.IntentsError as e:
        raise HTTPException(422, str(e)) from e
    d = Deposit(id="d-" + secrets.token_hex(6), customer_near_id=account.near_id, mode="live" if live else "preview",
                chain=q["chain"], symbol=q["symbol"], asset_id=body.asset_id, send=q["send"], expected=q["receive"],
                seconds=q["seconds"], deposit_address=q["deposit_address"], memo=q["memo"], deadline=q["deadline"])
    async with Session() as s:
        s.add(d)
        await s.commit()
    return deposit_view(d)


async def _deposit_of(deposit_id: str, account: Account) -> Deposit:
    async with Session() as s:
        d = await s.get(Deposit, deposit_id)
    if d is None or d.customer_near_id != account.near_id:
        raise HTTPException(404, "That deposit isn't yours.")
    return d


@app.get("/api/funding/deposits/{deposit_id}")
async def deposit_status(deposit_id: str, account: Account = Depends(customer_of)):
    """Ask NEAR Intents where a real deposit is. When it has arrived as USDC on NEAR mainnet,
    the same amount of sUSD is added to the testnet balance."""
    d = await _deposit_of(deposit_id, account)
    if d.mode == "live" and d.status in ("waiting", "received", "converting"):
        try:
            state, arrived = await intents.status(d.deposit_address, d.memo)
        except intents.IntentsError:
            return deposit_view(d)  # keep showing the last known state; the app asks again
        if state == "done":
            # Never credit more than the quote promised, whatever the status reply says.
            d = await _credit(d.id, account, min(arrived or d.expected, d.expected))
        elif state != d.status:
            async with Session() as s:
                row = await s.get(Deposit, d.id)
                row.status = state
                await s.commit()
                d = row
    return deposit_view(d)


@app.post("/api/funding/deposits/{deposit_id}/simulate")
async def simulate_deposit(deposit_id: str, account: Account = Depends(customer_of)):
    """Preview only: act as if the deposit arrived, and add demo sUSD. No real money is involved."""
    d = await _deposit_of(deposit_id, account)
    if d.mode != "preview":
        raise HTTPException(409, "This is a real deposit. It is added when the coins arrive.")
    return deposit_view(await _credit(d.id, account, d.expected))


class Picked(BaseModel):
    sku: str = Field(max_length=40)
    qty: int = Field(ge=1, le=50)


class Spend(BaseModel):
    sku: str | None = Field(default=None, max_length=40)  # none: the shop lists no price for it
    amount_kes: int = Field(ge=1, le=1_000_000)
    note: str = Field(default="", max_length=60)


class OrderIn(BaseModel):
    shop: str
    goal: str = Field(min_length=3, max_length=300)
    mode: str = "pickup"
    presence: str | None = None
    party_size: int = Field(default=1, ge=1, le=8)
    # Exactly what to buy, for gate tickets: [{"sku": ..., "qty": ...}]. The agents then skip the haggling.
    items: list[Picked] | None = Field(default=None, max_length=12)
    # An amount the cashier keyed in at a counter.
    charge: str | None = Field(default=None, max_length=20)
    # At a counter, the customer names the money: "diesel for 1,500". The shop's agent works out what it buys.
    spend: Spend | None = None


@app.post("/api/orders")
async def create_order(body: OrderIn, account: Account = Depends(customer_of)):
    basket = [i.model_dump() for i in body.items] if body.items else None
    return sse(lambda emit: orders.run_order(
        account, body.shop, body.goal.strip(), "table" if body.mode == "table" else "pickup", body.presence,
        1 if basket or body.charge or body.spend else body.party_size, emit, basket, body.charge,
        spend=body.spend.model_dump() if body.spend else None), busy_key=account.near_id)


@app.post("/api/orders/{order_id}/join")
async def join(order_id: str, account: Account = Depends(customer_of)):
    return sse(lambda emit: orders.join_order(order_id, account, emit), busy_key=account.near_id)


# ---------------------------------------------------------------- merchant console


class HoursIn(BaseModel):
    open: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    close: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class NewItem(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    price_kes: int = Field(gt=0, le=1_000_000)  # whole shillings
    category: str = Field(default="main", pattern="^(main|side|drink)$")
    # A counter's price list: what the price is for ("litre", "kg", "loaf"), and whether it is only sold whole.
    unit: str = Field(default="", max_length=12)
    whole: bool = False


class ShopIn(BaseModel):
    kind: str = Field(pattern="^(venue|food|counter)$")
    name: str = Field(min_length=2, max_length=60)
    place: str = Field(default="", max_length=120)
    blurb: str = Field(default="", max_length=200)
    hours: HoursIn | None = None
    items: list[NewItem] = Field(default_factory=list, max_length=20)


@app.post("/api/shop")
async def open_shop(body: ShopIn, user: User = Depends(current_user)):
    """The owner sets the shop up themselves. It stays pending until an admin approves it."""
    if body.kind == "venue" and body.hours is None:
        raise HTTPException(422, "Add the hours your gate is open.")
    if body.hours and body.hours.open == body.hours.close:
        raise HTTPException(422, "Opening and closing time can't be the same.")
    if body.kind != "counter" and not body.items:
        raise HTTPException(422, "Add at least one thing you sell.")
    hours = {**body.hours.model_dump(), "tz": "Africa/Nairobi"} if body.hours else None
    try:
        return public(await accounts.setup_shop(user, body.kind, body.name.strip(), body.place.strip(), body.blurb.strip(),
                                                hours, [i.model_dump() for i in body.items]))
    except accounts.TooManyShops:
        raise HTTPException(422, f"You can have up to {accounts.MAX_SHOPS} shops on one account.") from None
    except near.ContractError as e:
        raise setup_error(e) from e


@app.post("/api/shop/resume")
async def resume_shop(user: User = Depends(current_user)):
    """Finish a shop setup that stopped half-way."""
    account = next((a for a in await accounts.shops_of(user.id) if not a.ready), None)
    if account is None:
        raise HTTPException(404, "There is no unfinished shop setup.")
    try:
        return public(await accounts._finish(account))
    except near.ContractError as e:
        raise setup_error(e) from e


@app.get("/api/console")
async def console(account: Account = Depends(merchant_of)):
    shop_id = account.near_id

    async def bal(near_id: str) -> int:
        return int(await near.view("get_balance", {"account_id": near_id}))

    async with Session() as s:
        shop = await s.get(Shop, shop_id)
        supplier = await s.get(Shop, shop.supplier_near_id) if shop.supplier_near_id else None
        recent = list(await s.scalars(select(Order).where(Order.shop_near_id == shop_id).order_by(Order.created_at.desc()).limit(15)))
        logs = list(await s.scalars(select(AgentLog).where(AgentLog.shop_near_id == shop_id).order_by(AgentLog.at.desc()).limit(40)))
    onchain, balance, limits = await asyncio.gather(
        near.view("get_merchant", {"account_id": shop_id}), bal(shop_id), near.view("get_limits", {"account_id": shop_id}))
    splits = (onchain or {}).get("splits", [])
    shares = await asyncio.gather(*(bal(x["account_id"]) for x in splits))
    who = await orders.names(list({o.customer_near_id for o in recent}))
    # Who has gone in on a ticket, or collected a counter sale: a refund is no longer possible after that.
    passes = [o for o in recent if o.kind == "Ticket" and o.status == "paid" and o.invoice_id]
    used = dict(zip((o.id for o in passes), await asyncio.gather(*(near.view("get_ticket", {"id": o.invoice_id}) for o in passes)), strict=True))
    return {
        "near_id": shop_id, "name": shop.name, "place": shop.place, "blurb": shop.blurb, "rules": shop.rules,
        "kind": shop.kind, "status": shop.status, "hours": shop.hours, "open": policy.gate_now(shop.hours).open,
        "verified": bool(onchain and onchain["verified"]), "agents": llm.mode_label(),
        "balance": balance, "limits": limits and {k: int(limits[k]) for k in ("per_payment", "per_day", "spent_in_window")},
        "splits": [{"account_id": x["account_id"], "bps": x["bps"], "balance": b} for x, b in zip(splits, shares, strict=True)],
        "supplier": supplier and {"near_id": supplier.near_id, "name": supplier.name},
        "presence": presence.token(shop_id),
        "items": [{**i, "unit": policy.unit_of(i), "whole": policy.sold_whole(i)} for i in await orders.shop_items(shop_id)],
        "voice": voice.enabled(),
        "orders": [{"id": o.id, "customer": who[o.customer_near_id], "party_size": o.party_size, "goal": o.goal, "mode": o.mode,
                    "status": o.status, "invoice_id": o.invoice_id, "kind": o.kind, "total": o.total, "lines": o.lines,
                    "admitted": (used.get(o.id) or {}).get("admitted", 0), "admits": (used.get(o.id) or {}).get("admits", 0),
                    "code": policy.pickup_code(o.invoice_id) if o.mode == "counter" and o.invoice_id else None,
                    "agents": o.agent_mode, "at": (o.paid_at or o.created_at).isoformat()} for o in recent],
        "kes_per_usd": fx.rate(),
        "discounts": [{**r, "says": policy.describe_rule(r)} for r in policy.discount_rules(shop.rules or {})],
        "charges": await open_charges(shop_id) if shop.kind == "counter" else [],
        "plans": await console_plans(shop_id),
        "log": [{"kind": x.kind, "text": x.text, "tx_hash": x.tx_hash, "at": x.at.isoformat()} for x in logs],
    }


class ItemIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    price_kes: int | None = Field(default=None, gt=0, le=1_000_000)
    stock: int | None = Field(default=None, ge=0, le=10_000)
    reorder_at: int | None = Field(default=None, ge=0, le=10_000)


@app.patch("/api/console/items/{sku}")
async def edit_item(sku: str, body: ItemIn, account: Account = Depends(merchant_of)):
    async with Session() as s:
        item = await s.scalar(select(Item).where(Item.shop_near_id == account.near_id, Item.sku == sku))
        if item is None:
            raise HTTPException(404, "That item isn't on your menu.")
        for k, v in body.model_dump(exclude_none=True).items():
            setattr(item, k, v)
        if body.price_kes is not None:
            item.price = fx.to_micro(body.price_kes)
        await s.commit()
    return {"ok": True}


@app.post("/api/console/items")
async def add_item(body: NewItem, account: Account = Depends(merchant_of)):
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        taken = set(await s.scalars(select(Item.sku).where(Item.shop_near_id == account.near_id)))
        if len(taken) >= 30:
            raise HTTPException(422, "That's the most items a shop can list.")
        s.add_all(accounts.new_items(account.near_id, shop.kind, [body.model_dump()], taken))
        await s.commit()
    return {"ok": True}


@app.delete("/api/console/items/{sku}")
async def remove_item(sku: str, account: Account = Depends(merchant_of)):
    async with Session() as s:
        item = await s.scalar(select(Item).where(Item.shop_near_id == account.near_id, Item.sku == sku))
        if item is None:
            raise HTTPException(404, "That item isn't on your list.")
        await s.delete(item)
        await s.commit()
    return {"ok": True}


class AboutIn(BaseModel):
    blurb: str = Field(default="", max_length=200)
    place: str = Field(default="", max_length=120)
    hours: HoursIn | None = None  # a venue must keep hours; for others they are only shown to customers


@app.post("/api/console/about")
async def set_about(body: AboutIn, account: Account = Depends(merchant_of)):
    """Who the shop is, where it is and when it is open: what a customer reads before what it sells."""
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        if shop.kind == "venue" and body.hours is None:
            raise HTTPException(422, "A venue needs opening hours: tickets stop working at closing time.")
        if body.hours and body.hours.open == body.hours.close:
            raise HTTPException(422, "Opening and closing time can't be the same.")
        shop.blurb, shop.place = " ".join(body.blurb.split()), body.place.strip()
        shop.hours = {**body.hours.model_dump(), "tz": (shop.hours or {}).get("tz", "Africa/Nairobi")} if body.hours else None
        await s.commit()
    return {"ok": True}


# ---- the owner asks the shop's agent


@app.get("/api/console/chats")
async def shop_chats(account: Account = Depends(merchant_of)):
    return {"chats": await chat.threads(account.near_id), "agent": llm.mode_label(), "voice": voice.enabled()}


@app.get("/api/console/chats/{thread_id}")
async def shop_chat_history(thread_id: str, account: Account = Depends(merchant_of)):
    return {"messages": await chat.history(account.near_id, thread_id)}


@app.delete("/api/console/chats/{thread_id}")
async def shop_chat_delete(thread_id: str, account: Account = Depends(merchant_of)):
    if not await chat.remove(account.near_id, thread_id):
        raise HTTPException(404, "That chat isn't this shop's.")
    return {"ok": True}


@app.post("/api/console/chat")
async def shop_chat_turn(body: ChatIn, account: Account = Depends(merchant_of)):
    """The owner asks the shop's agent about the business. It reads; it changes nothing."""
    async def facts(day: date | None = None) -> dict:
        if day:
            st = await statement(day, account)
            return {"day": st["day"], **{k: st["totals"][k] for k in ("sales_kes", "count", "refunds_kes", "refund_count", "net_kes", "people", "admitted", "refused")}}
        return await shop_facts(account)

    return sse(lambda emit: chat.run_shop(account, body.text.strip(), body.thread, emit, facts), busy_key="chat:" + account.near_id)


async def shop_facts(account: Account) -> dict:
    """What the shop's agent knows when the owner asks: money, sales, stock, subscribers, rules. All in shillings."""
    con, st = await asyncio.gather(console(account), stats(account))
    async with Session() as s:
        waiting = await s.scalar(select(func.count()).select_from(Subscription).where(
            Subscription.shop_near_id == account.near_id, Subscription.status == "needs_money")) or 0
        refused = list(await s.scalars(select(AgentLog).where(AgentLog.shop_near_id == account.near_id, AgentLog.kind == "refused")
                                       .order_by(AgentLog.at.desc()).limit(3)))
    peak = max(range(24), key=lambda h: st["hours"][h])
    week = st["days"][-7:]
    return {
        "shop": con["name"], "type": con["kind"], "verified": con["verified"], "hours": con["hours"], "open_now": con["open"],
        "balance": policy.fmt(con["balance"]),
        "set_aside": [{"to": x["account_id"].split(".")[0], "percent_of_each_sale": x["bps"] / 100, "balance": policy.fmt(x["balance"])} for x in con["splits"]],
        "today": {"sales_kes": st["today"]["sales"], "sales": st["today"]["count"], "refunds_kes": st["today"]["refunds"]},
        "yesterday": {"sales_kes": st["yesterday"]["sales"], "sales": st["yesterday"]["count"]},
        "last_7_days": {"sales_kes": sum(d["sales"] for d in week), "sales": sum(d["count"] for d in week),
                        "best_day": max(week, key=lambda d: d["sales"])["day"]},
        "busiest_hour_today": f"{peak:02d}:00" if st["hours"][peak] else None,
        "best_sellers_14_days": [{"name": t["name"], "sold": t["qty"], "kes": t["amount"]} for t in st["top"]],
        "prices": [{"name": i["name"], "kes": i["price_kes"], **({"per": i["unit"]} if i.get("unit") else {}),
                    **({"in_stock": i["stock"]} if con["kind"] == "food" else {})} for i in con["items"]],
        "waiting_to_be_handed_over": [{"customer": o["customer"], "code": o["code"]} for o in con["orders"] if o["code"] and o["status"] == "paid" and not o["admitted"]],
        "low_stock": [i["name"] for i in con["items"] if con["kind"] == "food" and i["stock"] <= 5],
        "plans": [{"name": p["name"], "kes": p["price_kes"], "billed": p["every"], "subscribers": p["subscribers"]} for p in con["plans"]],
        "subscriptions_waiting_for_customer_money": waiting,
        "discount_rules": [f"up to {d['percent']}% for {d['says']}" for d in con["discounts"]],
        "latest_sales": [{"customer": o["customer"], "what": ", ".join(f"{x['qty']} x {x['name']}" for x in o["lines"] or []) or o["goal"],
                          "kes": policy.shillings(o["total"]) if o["total"] else None, "status": o["status"]} for o in con["orders"][:6]],
        "recent_refused_payments": [x.text for x in refused],
        "recent_withdrawals": [{"amount": policy.fmt(m["amount"]), "as": f"{m['symbol']} on {m['chain']}"} for m in st["moves"][:3]],
    }


@app.post("/api/console/hours")
async def set_hours(body: HoursIn, account: Account = Depends(merchant_of)):
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        shop.hours = {**body.model_dump(), "tz": (shop.hours or {}).get("tz", "Africa/Nairobi")}
        await s.commit()
    return {"ok": True}


@app.get("/api/console/tickets/{invoice_id}")
async def look_up_ticket(invoice_id: str, account: Account = Depends(merchant_of)):
    """What the gate sees after scanning a ticket, before letting anyone in."""
    inv = await near.view("get_invoice", {"id": invoice_id.strip()})
    if inv is None or inv["merchant"] != account.near_id or inv["kind"] != "Ticket":
        raise HTTPException(404, "That isn't one of your tickets.")
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        order = await s.scalar(select(Order).where(Order.invoice_id == inv["id"]))
    who = await orders.names([c["account_id"] for c in inv["contributions"]])
    return {"id": inv["id"], "paid": inv["status"] == "Paid", "lines": order.lines if order else None,
            "holder": next(iter(who.values()), None), "gate_open": policy.gate_now(shop.hours).open,
            "ticket": ticket_view(await near.view("get_ticket", {"id": inv["id"]}))}


class RedeemIn(BaseModel):
    id: str = Field(min_length=3, max_length=64)
    count: int | None = Field(default=None, ge=1, le=100)


@app.post("/api/console/redeem")
async def redeem(body: RedeemIn, account: Account = Depends(merchant_of)):
    """The Merchant Agent lets ticket holders in. The contract refuses a used-up or expired ticket."""
    ticket_id = body.id.strip()
    try:
        sent = await near.call(account.near_id, accounts.agent_key(account), "redeem", {"id": ticket_id, "count": body.count})
    except near.ContractError as e:
        return {"ok": False, "reason": e.reason, "tx_hash": e.tx_hash}
    t = sent.value or {}
    async with Session() as s:
        order = await s.scalar(select(Order).where(Order.invoice_id == ticket_id))
    if order is not None and order.mode == "counter":
        what = policy.listing([policy.Line(**x) for x in order.lines or []])
        await log(account.near_id, "info", f"Handed over {what} (code {policy.pickup_code(ticket_id)}).", sent.tx_hash)
    else:
        await log(account.near_id, "info", f"Let in {body.count or 'everyone'} on ticket {ticket_id} ({t.get('admitted')} of {t.get('admits')} now in).", sent.tx_hash)
    return {"ok": True, "tx_hash": sent.tx_hash, "ticket": t}


class DiscountRule(BaseModel):
    kind: str = Field(pattern="^(total|group|time|returning)$")
    percent: float = Field(gt=0, le=50)
    min_kes: int | None = Field(default=None, ge=1, le=10_000_000)
    people: int | None = Field(default=None, ge=2, le=100)
    visits: int | None = Field(default=None, ge=1, le=1000)
    start: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class DiscountsIn(BaseModel):
    rules: list[DiscountRule] = Field(max_length=8)


@app.post("/api/console/discounts")
async def set_discounts(body: DiscountsIn, account: Account = Depends(merchant_of)):
    """The owner sets when a discount may be given, and how much at most. The shop's agent bargains inside these."""
    out = []
    for r in body.rules:
        need = {"total": r.min_kes, "group": r.people, "time": r.start and r.end, "returning": r.visits}[r.kind]
        if not need:
            raise HTTPException(422, "Fill in the condition for each discount rule.")
        rule = {"kind": r.kind, "percent": r.percent}
        if r.kind == "total":
            rule["min_kes"] = r.min_kes
        elif r.kind == "group":
            rule["people"] = r.people
        elif r.kind == "time":
            rule["from"], rule["to"] = r.start, r.end
        else:
            rule["visits"] = r.visits
        out.append(rule)
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        kept = {k: v for k, v in (shop.rules or {}).items() if k not in ("discounts", "tiers", "group_bps")}
        shop.rules = {**kept, "discounts": out}
        await s.commit()
    return {"ok": True}


async def console_plans(shop_id: str) -> list[dict]:
    async with Session() as s:
        plans = list(await s.scalars(select(Plan).where(Plan.shop_near_id == shop_id, Plan.active).order_by(Plan.price_kes)))
        counts = dict((await s.execute(select(Subscription.plan_id, func.count()).where(
            Subscription.shop_near_id == shop_id, Subscription.status.in_(("active", "needs_money", "paused"))).group_by(Subscription.plan_id))).all())
    return [{**plan_view(p), "subscribers": counts.get(p.id, 0)} for p in plans]


class PlanIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    price_kes: int = Field(ge=1, le=1_000_000)
    period: str = Field(pattern="^(test|week|month)$")


@app.post("/api/console/plans")
async def add_plan(body: PlanIn, account: Account = Depends(merchant_of)):
    """Offer something billed on a schedule. Customers subscribe themselves; your agent then bills each period."""
    async with Session() as s:
        if (await s.scalar(select(func.count()).select_from(Plan).where(Plan.shop_near_id == account.near_id, Plan.active)) or 0) >= 10:
            raise HTTPException(422, "That's the most plans a shop can offer.")
        s.add(Plan(id="p-" + secrets.token_hex(5), shop_near_id=account.near_id, name=body.name.strip(), price_kes=body.price_kes,
                   period_sec=subs.PERIODS[body.period]))
        await s.commit()
    return {"ok": True}


@app.delete("/api/console/plans/{plan_id}")
async def retire_plan(plan_id: str, account: Account = Depends(merchant_of)):
    """Stop offering a plan. People already subscribed stay subscribed until they cancel."""
    async with Session() as s:
        p = await s.get(Plan, plan_id)
        if p is None or p.shop_near_id != account.near_id:
            raise HTTPException(404, "That isn't one of your plans.")
        p.active = False
        await s.commit()
    return {"ok": True}


class ChargeIn(BaseModel):
    amount_kes: int = Field(ge=1, le=1_000_000)
    note: str = Field(default="", max_length=80)


@app.post("/api/console/charges")
async def new_charge(body: ChargeIn, account: Account = Depends(merchant_of)):
    """The cashier keys in what the customer owes. The customer scans the code and their agent pays it."""
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        if shop.kind != "counter":
            raise HTTPException(409, "Only a counter keys in amounts.")
        c = Charge(id="c-" + secrets.token_hex(5), shop_near_id=account.near_id, amount_kes=body.amount_kes, note=body.note.strip())
        s.add(c)
        await s.commit()
    return {"id": c.id}


@app.post("/api/console/charges/{charge_id}/cancel")
async def cancel_charge(charge_id: str, account: Account = Depends(merchant_of)):
    async with Session() as s:
        c = await s.get(Charge, charge_id)
        if c is None or c.shop_near_id != account.near_id or c.status != "open":
            raise HTTPException(404, "That amount isn't waiting any more.")
        if c.order_id:
            raise HTTPException(409, "A customer is paying it right now.")
        c.status = "cancelled"
        await s.commit()
    return {"ok": True}


# ---- the shop's money


@app.post("/api/console/withdraw")
async def shop_withdraw(body: PayoutIn, account: Account = Depends(merchant_of)):
    """Take money out of the shop's balance. Signed with the owner's full key: the shop's agent can't withdraw.
    On testnet the quote is real but no coins are sent on the other chain."""
    if not body.address:
        raise HTTPException(422, "Add the address the coins should go to.")
    if body.amount > int(await near.view("get_balance", {"account_id": account.near_id})):
        raise HTTPException(422, "That is more than the shop's balance.")
    try:
        q = await intents.payout_quote(body.asset_id, body.amount)
    except intents.IntentsError as e:
        raise HTTPException(422, str(e)) from e
    try:
        await near.refill_gas(account.near_id)
        sent = await near.withdraw(account.near_id, accounts.full_key(account), body.amount)
    except near.ContractError as e:
        raise HTTPException(502, f"NEAR did not complete the withdrawal: {e.reason}.") from e
    if sent.value is False:
        raise HTTPException(502, "The withdrawal didn't go through. The balance is unchanged.")
    d = Deposit(id="w-" + secrets.token_hex(6), customer_near_id=account.near_id, mode="out", chain=q["chain"], symbol=q["symbol"],
                asset_id=body.asset_id, send=q["receive"], expected=body.amount, seconds=q["seconds"],
                deposit_address=body.address.strip(), status="done", credited=body.amount, tx_hash=sent.tx_hash)
    async with Session() as s:
        s.add(d)
        await s.commit()
    await log(account.near_id, "info", f"The owner withdrew {policy.fmt(body.amount)}, priced as {q['receive']} {q['symbol']} on {q['chain_name']}.", sent.tx_hash)
    return deposit_view(d)


class SweepIn(BaseModel):
    account_id: str = Field(min_length=3, max_length=64)


@app.post("/api/console/sweep")
async def sweep(body: SweepIn, account: Account = Depends(merchant_of)):
    """Move the shop's own savings, set aside by the contract, back to the shop's balance."""
    if body.account_id != f"savings.{account.near_id}":
        raise HTTPException(422, "Only your savings can be moved back. A partner's share is theirs.")
    try:
        sent = await near.call(account.near_id, accounts.full_key(account), "sweep", {"from": body.account_id}, deposit=near.ONE_YOCTO)
    except near.ContractError as e:
        raise HTTPException(422, f"Not moved: {e.reason}.") from e
    moved = int(sent.value or 0)
    await log(account.near_id, "info", f"The owner moved {policy.fmt(moved)} from {body.account_id.split('.')[0]} to the shop's balance.", sent.tx_hash)
    return {"ok": True, "moved": moved, "tx_hash": sent.tx_hash}


@app.get("/api/console/stats")
async def stats(account: Account = Depends(merchant_of)):
    """Figures for the console's cards and charts: 30 days of sales, today by the hour against a usual day,
    what sells, how payments ended, and who bought."""
    SPAN = 30
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        tz = ZoneInfo((shop.hours or {}).get("tz", "Africa/Nairobi"))
        today = datetime.now(tz).date()
        since = datetime.combine(today - timedelta(days=SPAN - 1), clock.min, tz).astimezone(UTC)
        mine = Order.shop_near_id == account.near_id
        sold = list(await s.scalars(select(Order).where(mine, Order.paid_at >= since)))
        back = list(await s.scalars(select(Order).where(mine, Order.refunded_at >= since)))
        refused = list(await s.scalars(select(Order).where(mine, Order.status == "refused", Order.created_at >= since)))
        # Who had already paid here before today: they count as returning.
        known = set(await s.scalars(select(Order.customer_near_id).where(
            mine, Order.paid_at < datetime.combine(today, clock.min, tz).astimezone(UTC)).distinct()))
        moves = list(await s.scalars(select(Deposit).where(Deposit.customer_near_id == account.near_id, Deposit.mode == "out")
                                     .order_by(Deposit.created_at.desc()).limit(8)))

    def kes(o: Order) -> int:
        return round(fx.to_kes(o.total or 0, (o.settled or {}).get("rate")))

    days = {today - timedelta(days=n): {"sales": 0, "refunds": 0, "count": 0, "refunded": 0, "refused": 0, "who": set()} for n in range(SPAN - 1, -1, -1)}
    hours, usual = [0] * 24, [0.0] * 24
    earlier: set[date] = set()  # days in the last two weeks, before today, that had a sale
    items: dict[str, dict] = {}
    for o in sold:
        at = utc(o.paid_at).astimezone(tz)
        d = days.get(at.date())
        if d is None:
            continue
        d["sales"] += kes(o)
        d["count"] += 1
        d["who"].add(o.customer_near_id)
        if at.date() == today:
            hours[at.hour] += kes(o)
        elif (today - at.date()).days <= 14:
            usual[at.hour] += kes(o)
            earlier.add(at.date())
        if o.status == "paid" and (today - at.date()).days < 14:
            # What was actually paid, after any discount, shared across the lines by their list price.
            listed = sum(line["qty"] * line["unit_price"] for line in o.lines or []) or 1
            for line in o.lines or []:
                # A measured counter sale is one line named "Diesel, 12 litres": count it under "Diesel".
                name = line["name"].split(",")[0] if o.mode == "counter" else line["name"]
                it = items.setdefault(name, {"name": name, "qty": 0, "amount": 0})
                it["qty"] += line["qty"]
                it["amount"] += round(kes(o) * line["qty"] * line["unit_price"] / listed)
    for o in back:
        d = days.get(utc(o.refunded_at).astimezone(tz).date())
        if d:
            d["refunds"] += kes(o)
            d["refunded"] += 1
    for o in refused:
        d = days.get(utc(o.created_at).astimezone(tz).date())
        if d:
            d["refused"] += 1
    buyers = days[today]["who"]
    series = [{"day": day.isoformat(), **{k: v for k, v in d.items() if k != "who"}, "customers": len(d["who"])} for day, d in days.items()]
    # A usual day is the average of the days that had sales, so one earlier day is already something to compare with.
    return {"days": series, "hours": hours, "usual": [round(v / max(1, len(earlier))) for v in usual], "today": series[-1], "yesterday": series[-2],
            "now_hour": datetime.now(tz).hour,
            "returning_today": len(buyers & known),
            "top": sorted(items.values(), key=lambda x: -x["amount"])[:6],
            "moves": [{"id": d.id, "amount": d.credited, "at_ms": ms(d.created_at), "symbol": d.symbol,
                       "chain": intents.CHAINS.get(d.chain, d.chain.title())} for d in moves]}


class RefundIn(BaseModel):
    id: str = Field(min_length=3, max_length=64)


@app.post("/api/console/refund")
async def refund(body: RefundIn, account: Account = Depends(merchant_of)):
    """The owner gives a sale back in full. Signed with the owner's full key: the agent's key can't refund."""
    invoice_id = body.id.strip()
    async with Session() as s:
        order = await s.scalar(select(Order).where(Order.invoice_id == invoice_id, Order.shop_near_id == account.near_id))
    if order is None or order.status != "paid":
        raise HTTPException(404, "That isn't a paid sale of yours.")
    try:
        sent = await near.call(account.near_id, accounts.full_key(account), "refund", {"id": invoice_id}, deposit=near.ONE_YOCTO)
    except near.ContractError as e:
        why = ("your balance is lower than the sale, so there isn't enough to give back" if "insufficient" in e.reason
               else ("it has already been handed over" if order.mode == "counter" else "someone has already gone in on this ticket")
               if "already entered" in e.reason else e.reason)
        raise HTTPException(422, f"Not refunded: {why}.") from e
    async with Session() as s:
        row = await s.get(Order, order.id)
        row.status, row.refunded_at = "refunded", datetime.now(UTC)
        for line in row.lines or []:  # the goods go back on the shelf
            item = await s.scalar(select(Item).where(Item.shop_near_id == account.near_id, Item.sku == line["sku"]))
            if item and "ticket" not in item.tags:
                item.stock += line["qty"]
        await s.commit()
    await log(account.near_id, "refund", f"Refunded {policy.fmt(order.total)} in full ({invoice_id}).", sent.tx_hash)
    return {"ok": True, "tx_hash": sent.tx_hash}


@app.get("/api/console/statement")
async def statement(day: date | None = None, account: Account = Depends(merchant_of)):
    """One day's books, by the shop's own clock: what was sold, given back and shared out."""
    async with Session() as s:
        shop = await s.get(Shop, account.near_id)
        tz = ZoneInfo((shop.hours or {}).get("tz", "Africa/Nairobi"))
        day = day or datetime.now(tz).date()
        start = datetime.combine(day, clock.min, tz).astimezone(UTC)
        end = start + timedelta(days=1)
        mine = Order.shop_near_id == account.near_id
        sold = list(await s.scalars(select(Order).where(mine, Order.paid_at >= start, Order.paid_at < end).order_by(Order.paid_at)))
        back = list(await s.scalars(select(Order).where(mine, Order.refunded_at >= start, Order.refunded_at < end).order_by(Order.refunded_at)))
        refused = await s.scalar(select(func.count()).select_from(Order).where(mine, Order.status == "refused", Order.created_at >= start, Order.created_at < end))
    who = await orders.names(list({o.customer_near_id for o in sold + back}))
    tickets = await asyncio.gather(*(near.view("get_ticket", {"id": o.invoice_id}) if o.kind == "Ticket" else asyncio.sleep(0) for o in sold))

    def kes(o: Order, micro: int) -> int:
        return round(fx.to_kes(micro, (o.settled or {}).get("rate")))

    def people(o: Order) -> int:
        return sum(line["qty"] for line in o.lines or []) if o.kind == "Ticket" and shop.kind == "venue" else 0

    def payer(o: Order) -> str:
        more = o.party_size - 1
        return who[o.customer_near_id] + (f" and {more} {'other' if more == 1 else 'others'}" if more > 0 else "")

    rows = [{"id": o.invoice_id, "at": o.paid_at.isoformat(), "customer": payer(o), "kind": o.kind,
             "what": policy.listing([policy.Line(**line) for line in o.lines or []]), "people": people(o),
             "admitted": (t or {}).get("admitted", 0) if o.kind == "Ticket" else 0, "total": o.total, "total_kes": kes(o, o.total),
             "kept": (o.settled or {}).get("kept", o.total), "shares": (o.settled or {}).get("shares", []),
             "refunded": o.status == "refunded"} for o, t in zip(sold, tickets, strict=True)]
    shared: dict[str, int] = {}
    for r in rows:
        for x in r["shares"]:
            shared[x["account_id"]] = shared.get(x["account_id"], 0) + x["amount"]
    sales, refunds = sum(o.total for o in sold), sum(o.total for o in back)
    return {
        "day": day.isoformat(), "shop": shop.name, "kind": shop.kind, "rows": rows,
        "refunds": [{"id": o.invoice_id, "at": o.refunded_at.isoformat(), "customer": who[o.customer_near_id],
                     "total": o.total, "total_kes": kes(o, o.total)} for o in back],
        "totals": {"sales": sales, "sales_kes": sum(r["total_kes"] for r in rows), "count": len(sold),
                   "refunds": refunds, "refunds_kes": sum(kes(o, o.total) for o in back), "refund_count": len(back),
                   "net": sales - refunds, "net_kes": sum(r["total_kes"] for r in rows) - sum(kes(o, o.total) for o in back),
                   "people": sum(r["people"] for r in rows if not r["refunded"]), "admitted": sum(r["admitted"] for r in rows),
                   "shared": [{"account_id": k, "amount": v} for k, v in shared.items()],
                   # The shop's part of each sale, and what is left of it after what it gave back today.
                   "kept": sum(r["kept"] for r in rows), "kept_net": sum(r["kept"] for r in rows) - refunds, "refused": refused or 0},
    }


class SplitIn(BaseModel):
    savings_percent: float = Field(ge=0, le=90)
    partner_percent: float = Field(ge=0, le=90)
    partner_account: str = Field(default="", max_length=64)


@app.post("/api/console/split")
async def set_split(body: SplitIn, account: Account = Depends(merchant_of)):
    """The owner sets revenue sharing. Signed with the owner's full key: the agent's key can't do this."""
    if body.savings_percent + body.partner_percent > 90:
        raise HTTPException(422, "Keep at least 10% for the shop.")
    splits = []
    if body.savings_percent:
        splits.append({"account_id": f"savings.{account.near_id}", "bps": round(body.savings_percent * 100)})
    if body.partner_percent:
        partner = body.partner_account.strip().lower() or f"partner.{account.near_id}"
        splits.append({"account_id": partner, "bps": round(body.partner_percent * 100)})
    try:
        sent = await near.call(account.near_id, accounts.full_key(account), "set_revenue_split", {"splits": splits}, deposit=near.ONE_YOCTO)
    except near.ContractError as e:
        raise HTTPException(422, f"NEAR did not accept the split: {e.reason}.") from e
    return {"ok": True, "tx_hash": sent.tx_hash}


@app.post("/api/console/limits")
async def shop_limits(body: LimitsIn, account: Account = Depends(merchant_of)):
    if body.per_payment > body.per_day:
        raise HTTPException(422, "The per-purchase limit can't be higher than the daily limit.")
    sent = await near.set_limits(account.near_id, accounts.full_key(account), body.per_payment, body.per_day)
    return {"ok": True, "tx_hash": sent.tx_hash}


# ---------------------------------------------------------------- admin


@app.get("/api/admin")
async def admin_home(_: User = Depends(admin_of)):
    async with Session() as s:
        shops = list(await s.scalars(select(Shop).order_by(Shop.created_at.desc())))
        owners = {a.near_id: a for a in await s.scalars(select(Account).where(Account.role == "merchant"))}
        customers = await s.scalar(select(func.count()).select_from(Account).where(Account.role == "customer"))
        by_status = {k: v for k, v in (await s.execute(select(Order.status, func.count()).group_by(Order.status))).all()}
        recent = list(await s.scalars(select(Order).order_by(Order.created_at.desc()).limit(12)))
    shops = [x for x in shops if x.near_id in owners]
    verified = await asyncio.gather(*(near.view("is_verified", {"account_id": x.near_id}) for x in shops))
    names = {x.near_id: x.name for x in shops}
    return {
        "shops": [{"near_id": x.near_id, "name": x.name, "kind": x.kind, "place": x.place, "status": x.status, "hours": x.hours,
                   "verified_onchain": bool(v), "owner": owners[x.near_id].email,
                   "created_at": x.created_at.isoformat()} for x, v in zip(shops, verified, strict=True)],
        "stats": {"customers": customers, "orders": by_status,
                  "gas_reserve_near": round(await near.near_balance(settings.contract_id) / near.YOCTO_NEAR, 2)},
        "recent": [{"id": o.id, "shop": names.get(o.shop_near_id, o.shop_near_id), "status": o.status, "kind": o.kind,
                    "total": o.total, "goal": o.goal, "at": o.created_at.isoformat()} for o in recent],
    }


async def _review(near_id: str, verified: bool, status: str) -> dict:
    async with Session() as s:
        shop = await s.get(Shop, near_id)
    if shop is None:
        raise HTTPException(404, "There is no such shop.")
    try:
        sent = await near.set_verified(near_id, verified)
    except near.ContractError as e:
        raise HTTPException(502, f"NEAR did not accept that: {e.reason}.") from e
    async with Session() as s:
        row = await s.get(Shop, near_id)
        row.status = status
        await s.commit()
    await log(near_id, "info", "An admin verified this shop. Customers can now find it." if verified else "An admin suspended this shop.", sent.tx_hash)
    return {"ok": True, "tx_hash": sent.tx_hash}


@app.post("/api/admin/shops/{near_id}/approve")
async def approve_shop(near_id: str, _: User = Depends(admin_of)):
    """Verify the shop on the onchain register. Only then do customers' agents connect to it."""
    return await _review(near_id, True, "approved")


@app.post("/api/admin/shops/{near_id}/suspend")
async def suspend_shop(near_id: str, _: User = Depends(admin_of)):
    return await _review(near_id, False, "suspended")
