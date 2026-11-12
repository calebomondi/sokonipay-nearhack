"""Talking to your own agent. It answers questions about your money and goes shopping for you.

It never pays on its own say-so here: it finds the shop, agrees a price with the shop's agent,
then shows you the shop and the total and waits. Only a yes lets it accept the quote and pay,
and the contract's limits still apply after that."""

import asyncio
import json
from datetime import datetime
import re
import secrets

from langchain_core.tools import StructuredTool
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import fx, near, orders, policy
from app.agents import llm
from app.agents.a2a import Emit
from app.config import settings
from app.db import Account, ChatMessage, ChatThread, Order, Session, Shop, now

CONFIRM_WAIT = 300  # seconds a quote waits for a yes
_waiting: dict[str, asyncio.Future] = {}  # customer near_id -> the yes or no we are waiting for


def answer(near_id: str, yes: bool) -> bool:
    """The person's reply to "shall I pay?". False if nothing was waiting."""
    fut = _waiting.get(near_id)
    if fut is None or fut.done():
        return False
    fut.set_result(yes)
    return True


def _title(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 60 else text[:57].rstrip() + "…"


async def threads(near_id: str) -> list[dict]:
    """The person's conversations, newest first. Messages from before chats were separate become one chat."""
    async with Session() as s:
        loose = list(await s.scalars(select(ChatMessage).where(ChatMessage.customer_near_id == near_id, ChatMessage.thread_id.is_(None)).order_by(ChatMessage.id)))
        if loose:
            t = ChatThread(id="t-" + secrets.token_hex(6), customer_near_id=near_id, title=_title(loose[0].text),
                           created_at=loose[0].at, updated_at=loose[-1].at)
            s.add(t)
            for m in loose:
                m.thread_id = t.id
            await s.commit()
        rows = list(await s.scalars(select(ChatThread).where(ChatThread.customer_near_id == near_id).order_by(ChatThread.updated_at.desc()).limit(50)))
        paid = set(await s.scalars(select(ChatMessage.thread_id).join(Order, Order.id == ChatMessage.order_id).where(
            ChatMessage.customer_near_id == near_id, Order.status == "paid")))
    return [{"id": t.id, "title": t.title, "at": t.updated_at.isoformat(), "paid": t.id in paid} for t in rows]


async def remove(near_id: str, thread_id: str) -> bool:
    """Forget a conversation. Orders made in it stay: they are payments, not chat."""
    async with Session() as s:
        t = await s.get(ChatThread, thread_id)
        if t is None or t.customer_near_id != near_id:
            return False
        for m in await s.scalars(select(ChatMessage).where(ChatMessage.thread_id == thread_id)):
            await s.delete(m)
        await s.delete(t)
        await s.commit()
    return True


async def history(near_id: str, thread_id: str) -> list[dict]:
    async with Session() as s:
        rows = list(await s.scalars(select(ChatMessage).where(ChatMessage.customer_near_id == near_id, ChatMessage.thread_id == thread_id)
                                    .order_by(ChatMessage.id.desc()).limit(60)))
        ran = {o.id: o for o in await s.scalars(select(Order).where(Order.id.in_([m.order_id for m in rows if m.order_id])))}
        names = {x.near_id: x.name for x in await s.scalars(select(Shop))}
    return [{"role": m.role, "text": m.text, "at": m.at.isoformat(),
             "order": ({"shop": names.get(ran[m.order_id].shop_near_id, ""), "shop_id": ran[m.order_id].shop_near_id,
                        "events": ran[m.order_id].events} if m.order_id in ran else None)}
            for m in reversed(rows)]


async def _save(near_id: str, thread_id: str, role: str, text: str, order_id: str | None = None) -> None:
    async with Session() as s:
        s.add(ChatMessage(customer_near_id=near_id, thread_id=thread_id, role=role, text=text[:4000], order_id=order_id))
        t = await s.get(ChatThread, thread_id)
        t.updated_at = now()
        await s.commit()


class Helper:
    """What the agent can do for one person in one turn. The LLM and the scripted fallback both use it."""

    def __init__(self, account: Account, emit: Emit):
        self.account, self.emit = account, emit
        self.order_id: str | None = None
        self.declined = False

    async def my_account(self) -> dict:
        me = self.account.near_id
        balance, limits, invoices = await asyncio.gather(
            near.view("get_balance", {"account_id": me}), near.view("get_limits", {"account_id": me}),
            near.view("get_invoices_for", {"account_id": me, "limit": 30}))
        async with Session() as s:
            names = {x.near_id: x.name for x in await s.scalars(select(Shop))}
        paid = [i for i in invoices if i["status"] == "Paid" and i["merchant"] != me]
        left = int(limits["per_day"]) - int(limits["spent_in_window"]) if limits else 0
        return {
            "balance": policy.fmt(int(balance)),
            "agent_limit_per_payment": policy.fmt(int(limits["per_payment"])) if limits else "not set",
            "agent_limit_left_today": policy.fmt(max(0, left)),
            "recent_payments": [{"shop": names.get(i["merchant"], i["merchant"]), "amount": policy.fmt(int(i["amount"])),
                                 "what": "ticket" if i["kind"] == "Ticket" else "order", "receipt": i["id"]} for i in paid[:6]],
        }

    async def find_shops(self) -> list[dict]:
        """Every verified shop, with what it sells, whether it is open and how often this person has paid it."""
        await self.emit({"t": "step", "text": "Looking through verified shops"})
        async with Session() as s:
            shops = list(await s.scalars(select(Shop).where(Shop.listed, Shop.status == "approved")))
            used = dict((await s.execute(select(Order.shop_near_id, func.count()).where(
                Order.customer_near_id == self.account.near_id, Order.status == "paid").group_by(Order.shop_near_id))).all())
        out = []
        for x in shops:
            items = await orders.shop_items(x.near_id)
            out.append({"shop_id": x.near_id, "name": x.name, "place": x.place,
                        "kind": {"venue": "sells entry tickets", "food": "food stall", "counter": "pay-at-counter only"}.get(x.kind, x.kind),
                        "open_now": policy.gate_now(x.hours).open, "times_you_paid_here": used.get(x.near_id, 0),
                        "sells": [{"name": i["name"], "price": f"KES {i['price_kes']:,}", "in_stock": i["stock"] > 0} for i in items]})
        return sorted(out, key=lambda x: -x["times_you_paid_here"])

    async def _approve(self, shop: Shop, quote: dict) -> bool:
        """Show the person the shop and the total, and wait for their yes."""
        me = self.account.near_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        _waiting[me] = fut
        await self.emit({"t": "confirm", "shop": shop.name, "shop_id": shop.near_id, "total": quote["total"],
                         "discount_bps": quote.get("discount_bps", 0), "lines": quote["lines"], "wait_s": CONFIRM_WAIT})
        try:
            yes = await asyncio.wait_for(fut, CONFIRM_WAIT)
        except TimeoutError:
            yes = False
        finally:
            _waiting.pop(me, None)
        self.declined = not yes
        await self.emit({"t": "confirmed", "yes": yes})
        return yes

    async def order(self, shop_id: str, request: str, tickets: list[dict] | None = None) -> dict:
        """Run one order at one shop through the usual agent-to-agent flow, pausing for a yes before paying."""
        if self.order_id:
            return {"error": "One order per message. Tell the customer the result of the first one."}
        async with Session() as s:
            shop = await s.get(Shop, shop_id)
        if shop is None or shop.status != "approved":
            return {"error": "That shop_id is not a verified shop. Use find_shops and copy a shop_id from it."}
        if shop.kind == "counter":
            return {"error": f"{shop.name} takes payment at its counter only: the cashier keys in the amount and the customer scans the code there."}
        basket = None
        if shop.kind == "venue":
            items = await orders.shop_items(shop_id)
            by_name = {i["name"].lower(): i for i in items}
            basket = [{"sku": by_name[t["name"].lower()]["sku"], "qty": max(1, min(20, int(t.get("qty", 1))))}
                      for t in tickets or [] if str(t.get("name", "")).lower() in by_name]
            if not basket:
                return {"error": f"Say which tickets and how many. {shop.name} sells: " + ", ".join(f"{i['name']} (KES {i['price_kes']:,})" for i in items)}

        said: dict = {}

        async def emit(e: dict) -> None:
            if e["t"] in ("error", "refused"):
                said["why"] = e.get("text") or e.get("reason") or ""
            if e["t"] == "done":
                self.order_id = e["order_id"]
            else:
                await self.emit({"t": "order", "shop": shop.name, "shop_id": shop.near_id, "ev": e})

        await self.emit({"t": "step", "text": f"Talking to {shop.name}'s agent"})
        done = await orders.run_order(self.account, shop_id, request[:300], "pickup", None, 1, emit, basket,
                                      approve=lambda q: self._approve(shop, q))
        self.order_id = done.id
        if done.status == "paid":
            return {"result": "paid", "shop": shop.name, "total": policy.fmt(done.total), "receipt": done.invoice_id,
                    "is_ticket": done.kind == "Ticket"}
        if self.declined:
            return {"result": "not paid", "why": "The customer chose not to go ahead when shown the total."}
        return {"result": "refused by the contract" if done.status == "refused" else "not paid", "why": said.get("why", "")}


# ---------------------------------------------------------------- LLM


class _Ticket(BaseModel):
    name: str = Field(description="Ticket name exactly as the venue lists it, e.g. Adult")
    qty: int = Field(ge=1, le=20)


async def _with_llm(h: Helper, text: str, past: list[dict]) -> str:
    async def my_account() -> str:
        return json.dumps(await h.my_account())

    async def find_shops() -> str:
        return json.dumps(await h.find_shops())

    async def buy_tickets(shop_id: str, tickets: list[_Ticket]) -> str:
        wanted = [t.model_dump() if isinstance(t, BaseModel) else dict(t) for t in tickets]
        return json.dumps(await h.order(shop_id, ", ".join(f"{t['qty']} × {t['name']}" for t in wanted), wanted))

    async def order_food(shop_id: str, request: str) -> str:
        return json.dumps(await h.order(shop_id, request))

    tools = [
        StructuredTool.from_function(coroutine=my_account, name="my_account", description="The customer's balance, agent spending limits and recent payments."),
        StructuredTool.from_function(coroutine=find_shops, name="find_shops", description="All verified shops with what they sell, prices in KES, whether open, and how often the customer has paid there."),
        StructuredTool.from_function(coroutine=buy_tickets, name="buy_tickets", description="Buy entry tickets at a venue. The customer is asked to confirm the total before anything is paid."),
        StructuredTool.from_function(coroutine=order_food, name="order_food", description="Order from a food stall in the customer's own words, e.g. '2 chapati and a chai, under KES 300'. The customer is asked to confirm the total before anything is paid."),
    ]
    model, fallbacks = llm.chat()
    model = model.bind_tools(tools).with_fallbacks([m.bind_tools(tools) for m in fallbacks]) if fallbacks else model
    prompt = (
        f"You are the personal payments agent of {h.account.name} on SokoniPay, which pays verified businesses in Kenya. "
        "Amounts are in Kenyan shillings (KES). Be brief: one to three short sentences, plain text, no lists unless asked.\n"
        "- For questions about money, limits or past payments, call my_account and answer from it.\n"
        "- To buy something, call find_shops first. If the customer named a shop, use that one. If not, choose the shop whose "
        "items best match the request, preferring one that is open and one they have paid before, and say in a few words why you chose it.\n"
        "- Then call buy_tickets (venues) or order_food (food stalls) once. The customer confirms the total themselves in the app; do not ask them to confirm in words.\n"
        "- Report exactly what the tool returned. Never say something was paid unless the result is 'paid'. If it was not paid, say why.\n"
        "- You cannot change limits, add or withdraw money, or refund. Those are on the customer's Home screen (refunds come from the shop).\n"
        "- If no shop fits, say so and name what the shops do sell. Do not invent shops, items or prices."
    )
    agent = create_react_agent(model, tools, prompt=prompt)
    msgs = [("user" if m["role"] == "user" else "assistant", m["text"]) for m in past[-8:]] + [("user", text)]
    out = await agent.ainvoke({"messages": msgs}, config={"recursion_limit": 12})
    said = out["messages"][-1].content
    return (said if isinstance(said, str) else " ".join(p.get("text", "") for p in said if isinstance(p, dict))).strip()


# ---------------------------------------------------------------- without an LLM


async def _scripted(h: Helper, text: str) -> str:
    """Enough to be useful when no model is available: money questions, and orders that name what they want."""
    low = text.lower()
    if re.search(r"\b(balance|how much|limit|spent|spend|payments?|history|paid)\b", low) and not re.search(r"\b(buy|get me|order|ticket)\b", low):
        a = await h.my_account()
        last = a["recent_payments"][0] if a["recent_payments"] else None
        return (f"Your balance is {a['balance']}. I can spend up to {a['agent_limit_per_payment']} per payment, with {a['agent_limit_left_today']} left today."
                + (f" Your last payment was {last['amount']} at {last['shop']}." if last else ""))
    shops = await h.find_shops()
    named = [x for x in shops if any(len(w) > 3 and w in low for w in re.sub(r"\(.*?\)", "", x["name"]).lower().split())]
    wants_ticket = bool(re.search(r"\b(ticket|entry|admission)s?\b", low))
    pool = named or [x for x in shops if (x["kind"] == "sells entry tickets") == wants_ticket and x["kind"] != "pay-at-counter only"]
    hit = next((x for x in pool if any(len(w) > 3 and w in low for i in x["sells"] for w in i["name"].lower().split())), pool[0] if pool else None)
    if hit is None:
        return "I couldn't find a verified shop for that. Open Shops from Home to see what's available."
    if hit["kind"] == "sells entry tickets":
        tickets = []
        for i in hit["sells"]:
            m = re.search(rf"(\d+|one|two|three|four|five|six|a|an)\s+{re.escape(i['name'].lower())}", low)
            if m:
                tickets.append({"name": i["name"], "qty": {"one": 1, "a": 1, "an": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}.get(m.group(1)) or int(m.group(1))})
        r = await h.order(hit["shop_id"], text, tickets)
    else:
        r = await h.order(hit["shop_id"], text)
    if "error" in r:
        return r["error"]
    if r["result"] == "paid":
        return f"Done. I paid {r['total']} at {r['shop']}." + (" Your ticket is under Tickets." if r.get("is_ticket") else "")
    return f"Nothing was paid at {hit['name']}. {r.get('why', '')}".strip()


async def run(account: Account, text: str, thread_id: str | None, emit: Emit) -> None:
    """One turn: the person says something, the agent works and answers. No `thread_id` starts a new chat."""
    await fx.refresh()
    me = account.near_id
    async with Session() as s:
        t = await s.get(ChatThread, thread_id) if thread_id else None
        if t is None or t.customer_near_id != me:
            t = ChatThread(id="t-" + secrets.token_hex(6), customer_near_id=me, title=_title(text))
            s.add(t)
            await s.commit()
    await emit({"t": "thread", "id": t.id, "title": t.title})
    past = await history(me, t.id)
    await _save(me, t.id, "user", text)
    h = Helper(account, emit)
    try:
        said = await _with_llm(h, text, past) if settings.llm_enabled else await _scripted(h, text)
    except Exception as e:
        if h.order_id:  # an order already ran: report it rather than risk a second one
            said = "I ran the order above, but couldn't write a summary. Check the result in it."
        else:
            await emit({"t": "step", "text": f"The AI model is unavailable ({type(e).__name__}), using built-in rules"})
            try:
                said = await _scripted(h, text)
            except Exception:
                said = "Something went wrong on my side and nothing was paid. Try again in a moment."
    said = said or "I'm not sure how to help with that. Ask about your balance, or tell me what to buy."
    await _save(me, t.id, "agent", said, h.order_id)
    await emit({"t": "say", "text": said})


# ---------------------------------------------------------------- the shop owner's side


async def run_shop(account: Account, text: str, thread_id: str | None, emit: Emit, facts) -> None:
    """One turn of the owner asking the shop's agent about the business. It reads the shop's figures and answers.
    It changes nothing: refunds, withdrawals, prices and the split are the owner's own actions in the console.
    `facts(day=None)` returns the shop's current figures, or one day's totals."""
    await fx.refresh()
    me = account.near_id
    async with Session() as s:
        t = await s.get(ChatThread, thread_id) if thread_id else None
        if t is None or t.customer_near_id != me:
            t = ChatThread(id="t-" + secrets.token_hex(6), customer_near_id=me, title=_title(text))
            s.add(t)
            await s.commit()
    await emit({"t": "thread", "id": t.id, "title": t.title})
    past = await history(me, t.id)
    await _save(me, t.id, "user", text)

    async def summary() -> str:
        f = await facts()
        best = f["best_sellers_14_days"][0]["name"] if f["best_sellers_14_days"] else None
        return (f"Today: KES {f['today']['sales_kes']:,} from {f['today']['sales']} sales (yesterday KES {f['yesterday']['sales_kes']:,}). "
                f"Balance {f['balance']}." + (f" Best seller: {best}." if best else ""))

    try:
        if not settings.llm_enabled:
            said = await summary()
        else:
            async def shop_figures() -> str:
                await emit({"t": "step", "text": "Reading the shop's figures"})
                return json.dumps(await facts())

            async def day_totals(day: str) -> str:
                await emit({"t": "step", "text": f"Reading {day}"})
                try:
                    return json.dumps(await facts(datetime.strptime(day, "%Y-%m-%d").date()))
                except ValueError:
                    return json.dumps({"error": "Give the day as YYYY-MM-DD."})

            tools = [
                StructuredTool.from_function(coroutine=shop_figures, name="shop_figures", description="The shop's current figures: balance, money set aside, sales today, yesterday and the last 7 days, best sellers, prices and stock, plans and subscribers, discount rules, latest sales, refused payments and withdrawals. Amounts are in KES."),
                StructuredTool.from_function(coroutine=day_totals, name="day_totals", description="Totals for one day, given as YYYY-MM-DD: sales, refunds, net, people who bought and who were admitted, refused payments."),
            ]
            model, fallbacks = llm.chat()
            model = model.bind_tools(tools).with_fallbacks([m.bind_tools(tools) for m in fallbacks]) if fallbacks else model
            prompt = (
                f"You are the business agent of {account.name}, a shop on SokoniPay in Kenya. The owner is asking you about their shop. "
                f"Today is {datetime.now().strftime('%A %Y-%m-%d')}. Amounts are in Kenyan shillings (KES).\n"
                "- Call shop_figures before answering anything about the business, and day_totals for a specific past day.\n"
                "- Answer in one to four short sentences of plain text, with the actual numbers. Compare with yesterday when it helps.\n"
                "- You may point out something worth acting on (stock running low, a refused payment, a day that dipped) in one sentence.\n"
                "- You only read. You cannot refund, withdraw, change prices, stock, hours, discounts or the split. If asked, say which "
                "section of the console does it: Sales (refunds), Overview (withdraw), Tickets or Menu (prices and stock), Settings (about, discounts, split), Subscriptions (plans).\n"
                "- Use only what the tools return. If the figures don't answer the question, say so."
            )
            agent = create_react_agent(model, tools, prompt=prompt)
            msgs = [("user" if m["role"] == "user" else "assistant", m["text"]) for m in past[-8:]] + [("user", text)]
            out = await agent.ainvoke({"messages": msgs}, config={"recursion_limit": 10})
            c = out["messages"][-1].content
            said = (c if isinstance(c, str) else " ".join(p.get("text", "") for p in c if isinstance(p, dict))).strip()
    except Exception as e:
        await emit({"t": "step", "text": f"The AI model is unavailable ({type(e).__name__}), so here are the headline figures"})
        try:
            said = await summary()
        except Exception:
            said = "I couldn't read the shop's figures just now. Try again in a moment."
    said = said or "I'm not sure how to help with that. Ask about sales, stock, subscribers or the balance."
    await _save(me, t.id, "agent", said)
    await emit({"t": "say", "text": said})
