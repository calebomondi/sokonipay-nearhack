"""The Personal Agent: orders and pays for one customer.

`Checkout` is the only way it can spend, and it checks the onchain invoice against the
quote the agent accepted before it signs. The agent holds the customer's function-call
key (pay_invoice, contribute) and nothing else. Limits are enforced by the contract."""

import json
from dataclasses import dataclass, field

from langchain_core.tools import StructuredTool
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel, Field

from app import near, policy
from app.agents import llm
from app.agents.a2a import Channel, Emit
from app.config import settings
from app.policy import Line, fmt


@dataclass
class Outcome:
    status: str = "failed"  # paid | collecting | refused | failed
    reason: str = ""
    invoice: dict | None = None
    paid: list[dict] = field(default_factory=list)  # [{id, amount, hash}]
    onchain: dict | None = None


class Checkout:
    def __init__(self, customer_id: str, agent_key: str, shop_id: str, party_size: int, label: str, emit: Emit,
                 approve=None):
        # `approve(quote) -> bool` asks the person before anything is agreed. Without it the agent goes ahead,
        # which is right when the person pressed a button for exactly this purchase.
        self._approve = approve
        self.customer_id, self._key, self.shop_id = customer_id, agent_key, shop_id
        self.party_size, self.label, self._emit = party_size, label, emit
        self.accepted: dict | None = None
        self.outcome = Outcome()

    async def approved(self, quote: dict) -> bool:
        """May the agent accept this quote? Asked once, before the shop is told to issue an invoice."""
        if self._approve is None or await self._approve(quote):
            return True
        self.outcome.status, self.outcome.reason = "failed", "You didn't confirm, so nothing was ordered or paid."
        return False

    async def pay(self, invoice: dict) -> Outcome:
        """Pay the invoice (or this customer's share of a group invoice) if it matches the accepted quote."""
        out = self.outcome
        out.invoice = invoice
        onchain = await near.view("get_invoice", {"id": invoice["invoice_id"]})
        ok = (onchain and self.accepted and onchain["merchant"] == self.shop_id
              and int(onchain["amount"]) == self.accepted["total"] and onchain["status"] == "Open")
        if not ok:
            out.status, out.reason = "failed", "The onchain invoice does not match the agreed quote. Your agent did not pay."
            await self._emit({"t": "error", "text": out.reason})
            return out
        total = int(onchain["amount"])
        try:
            if onchain["kind"] == "Group":
                amount = policy.share_of(total, self.party_size, len(onchain["contributions"]))
                sent = await near.call(self.customer_id, self._key, "contribute", {"id": invoice["invoice_id"], "amount": str(amount)})
                label = f"Paid a {fmt(amount)} share into escrow"
            else:
                amount = total
                sent = await near.call(self.customer_id, self._key, "pay_invoice", {"id": invoice["invoice_id"]})
                label = f"Paid {fmt(amount)}"
        except near.ContractError as e:
            out.status, out.reason = "refused", e.reason
            await self._emit({"t": "refused", "reason": e.reason, "hash": e.tx_hash,
                              "text": f"The contract refused the payment: {e.reason}."})
            return out
        await self._emit({"t": "tx", "who": self.label, "label": label, "hash": sent.tx_hash})
        out.paid.append({"id": self.customer_id, "amount": amount, "hash": sent.tx_hash})
        out.onchain = sent.value
        out.status = "paid" if (sent.value or {}).get("status") == "Paid" else "collecting"
        return out


# ---------------------------------------------------------------- scripted


class ScriptedPersonal:
    def __init__(self, goal: str, party_size: int, items: list[dict], channel: Channel, checkout: Checkout,
                 basket: list[dict] | None = None):
        self.goal, self.party, self.items, self.channel, self.checkout = goal, party_size, items, channel, checkout
        self.basket = basket  # exactly what the person picked: buy it at the listed price, no haggling

    async def _buy_as_picked(self) -> Outcome:
        out = self.checkout.outcome
        lines, _ = policy.price_request(self.items, self.basket or [])
        if not lines:
            out.reason = "There is nothing to pay for yet."
            return out
        q = await self.channel.send({
            "type": "request_quote", "items": [{"sku": line.sku, "qty": line.qty} for line in lines],
            "lines": [line.dict() for line in lines], "note": f"Hello. {policy.listing(lines)}, please. What is the total?",
        })
        if q["type"] != "quote":
            out.reason = q.get("note", "The shop could not quote that.")
            return out
        if q.get("negotiable"):
            # Nothing to choose here, but a price is still worth asking about: the shop may have a discount rule that fits.
            better = await self.channel.send({"type": "counter", "quote_id": q["quote_id"], "note": f"Is there a discount my customer qualifies for on {fmt(q['total'])}?"})
            if better["type"] == "quote" and better["total"] <= q["total"]:
                q = better
        if not await self.checkout.approved(q):
            return out
        self.checkout.accepted = q
        inv = await self.channel.send({"type": "accept", "quote_id": q["quote_id"], "note": f"Agreed at {fmt(q['total'])}. Send the invoice."})
        if inv["type"] != "invoice":
            out.reason = inv.get("note", "The shop did not issue an invoice.")
            return out
        return await self.checkout.pay(inv)

    async def run(self) -> Outcome:
        if self.basket is not None:
            return await self._buy_as_picked()
        out = self.checkout.outcome
        g = policy.parse_goal(self.goal, self.party)
        basket = policy.scripted_basket(self.items, self.goal, self.party)
        if not basket:
            out.reason = "Your agent found nothing on the menu that matches. Try naming a dish."
            return out
        group = self.party > 1
        q = await self.channel.send({
            "type": "request_quote", "items": [{"sku": line.sku, "qty": line.qty} for line in basket],
            "lines": [line.dict() for line in basket],
            "note": f"Hello. {f'I am ordering for {self.party} people: ' if group else 'I would like '}{policy.listing(basket)}. What is your price?",
        })
        if q["type"] != "quote":
            out.reason = q.get("note", "The shop could not quote that.")
            return out
        over = g.budget is not None and q["total"] > g.budget
        q = await self.channel.send({
            "type": "counter", "quote_id": q["quote_id"],
            "note": (f"My customer's budget is {fmt(g.budget)}. Can you do better on {fmt(q['total'])}?" if over
                     else f"Can you do better on {fmt(q['total'])}{' for a group order' if group else ''}?"),
        })
        if q["type"] != "quote":
            out.reason = q.get("note", "The shop could not quote that.")
            return out
        if g.budget is not None and q["total"] > g.budget:
            smaller = policy.trim_to_budget([Line(**line) for line in q["lines"]], g.budget)
            q = await self.channel.send({
                "type": "counter", "quote_id": q["quote_id"], "items": [{"sku": line.sku, "qty": line.qty} for line in smaller],
                "lines": [line.dict() for line in smaller], "note": f"Still over budget. Make it {policy.listing(smaller)} instead.",
            })
            if q["type"] != "quote" or q["total"] > g.budget:
                out.reason = f"Nothing on the menu fits {fmt(g.budget)}. Your agent did not order."
                return out
        if not await self.checkout.approved(q):
            return out
        self.checkout.accepted = q
        inv = await self.channel.send({"type": "accept", "quote_id": q["quote_id"], "note": f"Agreed at {fmt(q['total'])}. Send the invoice."})
        if inv["type"] != "invoice":
            out.reason = inv.get("note", "The shop did not issue an invoice.")
            return out
        return await self.checkout.pay(inv)


# ---------------------------------------------------------------- LLM (LangGraph ReAct)


class _Wanted(BaseModel):
    sku: str
    qty: int = Field(ge=1, le=50)


class _RequestQuote(BaseModel):
    items: list[_Wanted] = Field(description="What to order, by sku from the menu.")
    message: str = Field(description="One or two short sentences to the shop's agent.")


class _Counter(BaseModel):
    quote_id: str
    message: str = Field(description="A short sentence asking for a better price.")
    items: list[_Wanted] | None = Field(default=None, description="Only if you are changing the order, the new items.")


class _QuoteId(BaseModel):
    quote_id: str


class _InvoiceId(BaseModel):
    invoice_id: str


class LlmPersonal:
    """A LangGraph ReAct agent. It decides what to order and how to negotiate. Every tool
    checks its own preconditions in code, so a confused model cannot overpay."""

    def __init__(self, goal: str, party_size: int, items: list[dict], channel: Channel, checkout: Checkout,
                 customer_name: str, limits: dict | None, balance: int):
        self.goal, self.party, self.items, self.channel, self.checkout = goal, party_size, items, channel, checkout
        self.name, self.limits, self.balance = customer_name, limits, balance
        self.budget = policy.parse_goal(goal, party_size).budget
        self._invoices: dict[str, dict] = {}

    def _tools(self) -> list[StructuredTool]:
        ch, co = self.channel, self.checkout

        def lines_of(items: list[dict]) -> list[dict]:
            return [line.dict() for line in policy.price_request(self.items, items)[0]]

        async def read_menu() -> str:
            return json.dumps([{"sku": i["sku"], "name": i["name"], "price_kes": policy.shillings(i["price"]), "tags": i["tags"],
                                "in_stock": i["stock"]} for i in self.items if i["stock"] > 0])

        async def request_quote(items: list[_Wanted], message: str) -> str:
            wanted = [i.model_dump() if isinstance(i, BaseModel) else dict(i) for i in items]
            return json.dumps(_slim(await ch.send({"type": "request_quote", "items": wanted, "lines": lines_of(wanted), "note": message})))

        async def ask_for_better_price(quote_id: str, message: str, items: list[_Wanted] | None = None) -> str:
            msg = {"type": "counter", "quote_id": quote_id, "note": message}
            if items:
                msg["items"] = [i.model_dump() if isinstance(i, BaseModel) else dict(i) for i in items]
                msg["lines"] = lines_of(msg["items"])
            return json.dumps(_slim(await ch.send(msg)))

        async def accept_quote(quote_id: str) -> str:
            q = getattr(self, "_quotes", {}).get(quote_id)
            if q is None:
                return json.dumps({"error": "Unknown quote_id. Request a quote first."})
            if self.budget is not None and q["total"] > self.budget:
                return json.dumps({"error": f"That is over the customer's budget of {fmt(self.budget)}. Order less or ask for a better price."})
            if co.outcome.invoice:
                return json.dumps({"error": "An invoice was already issued for this order. Pay it."})
            if not await co.approved(q):
                return json.dumps({"error": "The customer did not confirm this order. Stop now and do nothing else."})
            co.accepted = q
            inv = await ch.send({"type": "accept", "quote_id": quote_id, "note": f"Agreed at {fmt(q['total'])}. Send the invoice."})
            if inv["type"] != "invoice":
                return json.dumps({"error": inv.get("note", "No invoice was issued.")})
            self._invoices[inv["invoice_id"]] = inv
            co.outcome.invoice = inv
            return json.dumps({"invoice_id": inv["invoice_id"], "total_kes": policy.shillings(inv["total"]), "kind": inv["kind"]})

        async def pay_invoice(invoice_id: str) -> str:
            inv = self._invoices.get(invoice_id)
            if inv is None:
                return json.dumps({"error": "Unknown invoice_id. Accept a quote first."})
            if co.outcome.paid or co.outcome.status == "refused":
                return json.dumps({"error": "This invoice was already handled. Stop and report the result."})
            out = await co.pay(inv)
            return json.dumps({"status": out.status, "reason": out.reason,
                               "paid_kes": policy.shillings(sum(p["amount"] for p in out.paid))})

        return [
            StructuredTool.from_function(coroutine=read_menu, name="read_menu", description="Read the shop's menu with prices and stock."),
            StructuredTool.from_function(coroutine=request_quote, name="request_quote", args_schema=_RequestQuote,
                                         description="Ask the shop's agent to price an order. Returns a quote."),
            StructuredTool.from_function(coroutine=ask_for_better_price, name="ask_for_better_price", args_schema=_Counter,
                                         description="Ask the shop's agent for a better price on a quote, or change the order. Returns a new quote."),
            StructuredTool.from_function(coroutine=accept_quote, name="accept_quote", args_schema=_QuoteId,
                                         description="Accept a quote. The shop issues an onchain invoice and you get its id."),
            StructuredTool.from_function(coroutine=pay_invoice, name="pay_invoice", args_schema=_InvoiceId,
                                         description="Pay the invoice from the customer's balance. The contract may refuse if it is over the customer's limits."),
        ]

    async def run(self) -> Outcome:
        self._quotes: dict[str, dict] = {}
        send = self.channel.send

        async def remembering(message: dict) -> dict:  # keep every quote the shop sends, by id
            reply = await send(message)
            if reply.get("type") == "quote":
                self._quotes[reply["quote_id"]] = reply
            return reply

        self.channel.send = remembering  # type: ignore[method-assign]
        primary, others = llm.chat()
        tools = self._tools()
        model = primary.bind_tools(tools).with_fallbacks([m.bind_tools(tools) for m in others])
        limits = (f"The customer's onchain limits: {fmt(int(self.limits['per_payment']))} per payment, "
                  f"{fmt(int(self.limits['per_day']) - int(self.limits['spent_in_window']))} left today. " if self.limits else "")
        prompt = (
            f"You are the personal shopping agent for {self.name}. You order from a market kitchen by talking to the shop's AI agent, "
            "then pay. Work only through your tools.\n"
            f"{'This is a group order for ' + str(self.party) + ' people; choose enough for everyone. The bill is split equally and you pay one share. ' if self.party > 1 else ''}"
            f"The customer's balance is {fmt(self.balance)}. {limits}"
            f"{'Their budget for this order is ' + fmt(self.budget) + '; never accept a total above it. ' if self.budget else ''}\n"
            "Steps: 1) read_menu. 2) request_quote for what best fits the request (respect diet and budget; if they ask for a ticket or entry, "
            "order only the ticket item, quantity 1). 3) ask_for_better_price once. 4) accept_quote on the best quote. 5) pay_invoice. "
            "6) Reply with one short sentence saying what happened. If the contract refuses the payment, do not retry: say why.\n"
            "Do not invent prices or skus. Amounts are in Kenyan shillings (KES)."
        )
        agent = create_react_agent(model, tools, prompt=prompt)
        try:
            await agent.ainvoke({"messages": [("user", self.goal)]}, config={"recursion_limit": 18})
        finally:
            self.channel.send = send  # type: ignore[method-assign]
        out = self.checkout.outcome
        if out.invoice and not out.paid and out.status == "failed" and not out.reason:
            out = await self.checkout.pay(out.invoice)  # the model accepted but never paid: finish the job
        return out


def _slim(reply: dict) -> dict:
    """What the model needs from a shop reply, in KES."""
    if reply.get("type") != "quote":
        return {"error": reply.get("note", "The shop could not do that.")}
    return {
        "quote_id": reply["quote_id"], "total_kes": policy.shillings(reply["total"]), "discount_percent": reply["discount_bps"] / 100,
        "items": [{"sku": line["sku"], "name": line["name"], "qty": line["qty"]} for line in reply["lines"]],
        "out_of_stock": reply.get("missing", []), "shop_says": reply.get("note", ""),
    }


async def run_personal(goal: str, party_size: int, items: list[dict], channel: Channel, checkout: Checkout,
                       customer_name: str, limits: dict | None, balance: int, emit: Emit,
                       basket: list[dict] | None = None) -> Outcome:
    """LLM agent when a NEAR AI key is set. If it fails before any invoice exists, the scripted agent takes over.
    A picked basket (gate tickets) has nothing to decide, so it always takes the fast scripted path."""
    if basket is not None:
        return await ScriptedPersonal(goal, party_size, items, channel, checkout, basket).run()
    if settings.llm_enabled:
        try:
            out = await LlmPersonal(goal, party_size, items, channel, checkout, customer_name, limits, balance).run()
            if out.invoice or out.reason:
                return out
            if not out.reason and not out.invoice:
                out.reason = "Your agent and the shop didn't settle on an order, so nothing was paid. Try naming the dishes you want."
                return out
        except Exception as e:
            if checkout.outcome.reason and not checkout.outcome.invoice:  # the person said no: that is the answer
                return checkout.outcome
            if checkout.outcome.invoice:  # never start a second order on top of an issued invoice
                out = checkout.outcome
                if not out.paid and out.status == "failed":
                    return await checkout.pay(out.invoice)
                return out
            await emit({"t": "status", "ok": False, "text": f"The AI model is unavailable ({type(e).__name__}), so your agent is using its built-in rules."})
    return await ScriptedPersonal(goal, party_size, items, channel, checkout).run()
