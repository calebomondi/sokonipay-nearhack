"""The Merchant Agent: runs one shop's sales desk.

`Desk` is what the agent can do, with the owner's rules enforced in code. The agent,
scripted or LLM, only chooses among those actions. It holds the shop's function-call
key (create_invoice, pay_invoice, redeem) and nothing else."""

import hashlib
import json
import secrets
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

from app import near, policy
from app.agents import llm
from app.config import settings
from app.policy import Line, fmt


class Desk:
    def __init__(self, shop_id: str, shop_name: str, rules: dict, items: list[dict], agent_key: str,
                 customer_id: str, is_group: bool, hours: dict | None = None, party_size: int = 1, visits: int = 0,
                 fixed: bool = False):
        self.shop_id, self.shop_name, self.rules, self.items = shop_id, shop_name, rules, items
        self.hours, self.party_size, self.visits = hours, party_size, visits
        self.fixed = fixed  # the customer picked exactly what to buy (tickets, a counter sale)
        self._key, self.customer_id, self.is_group = agent_key, customer_id, is_group
        self.quotes: dict[str, dict] = {}

    def catalog(self) -> list[dict]:
        return [{"sku": i["sku"], "name": i["name"], "price_kes": policy.shillings(i["price"]), "tags": i["tags"], "in_stock": i["stock"]}
                for i in self.items if i["stock"] > 0]

    def best_offer(self, lines: list[Line]) -> tuple[int, str]:
        """The most the owner's rules allow for this order, and which rule. Tickets count one person each."""
        people = max(self.party_size, sum(line.qty for line in lines)) if policy.is_ticket(self.items, lines) else self.party_size
        return policy.allowed_discount(self.rules, lines, people, self.visits, tz=(self.hours or {}).get("tz", "Africa/Nairobi"))

    def max_discount_bps(self, lines: list[Line]) -> int:
        return self.best_offer(lines)[0]

    def quote(self, wanted: list[dict], discount_bps: int = 0, note: str = "") -> dict:
        """Price a request. The discount is clamped to the owner's rules whatever was asked for."""
        lines, missing = policy.price_request(self.items, wanted)
        if not lines:
            return {"type": "error", "note": f"We're out of {', '.join(missing) or 'that'}."}
        if policy.is_ticket(self.items, lines):
            gate = policy.gate_now(self.hours)
            if not gate.open:
                return {"type": "error", "note": gate.says}
        bps = max(0, min(int(discount_bps), self.max_discount_bps(lines)))
        sub = policy.subtotal(lines)
        q = {"type": "quote", "quote_id": "q-" + secrets.token_hex(3), "lines": [line.dict() for line in lines],
             "subtotal": sub, "discount_bps": bps, "total": policy.apply_discount(sub, bps), "missing": missing, "note": note,
             "negotiable": bps < self.max_discount_bps(lines)}
        self.quotes[q["quote_id"]] = q
        return q

    async def issue_invoice(self, quote_id: str) -> dict:
        """Write the accepted quote onchain as an invoice, signed with the shop's agent key."""
        q = self.quotes.get(quote_id)
        if q is None:
            return {"type": "error", "note": "I don't have that quote. Ask for a new one."}
        lines = [Line(**line) for line in q["lines"]]
        kind = "Ticket" if policy.is_ticket(self.items, lines) else "Group" if self.is_group else "Single"
        invoice_id = {"Ticket": "tkt", "Group": "grp", "Single": "ord"}[kind] + "-" + secrets.token_hex(5)
        args = {
            "id": invoice_id, "amount": str(q["total"]), "kind": kind, "expires_in_sec": 3600 if kind == "Group" else 900,
            "items_hash": hashlib.sha256(json.dumps(q["lines"], sort_keys=True).encode()).hexdigest(),
            "payer": None if kind == "Group" else self.customer_id,
        }
        if kind == "Ticket":
            # The ticket itself: one entry per ticket bought, good until closing time today.
            gate = policy.gate_now(self.hours)
            if not gate.open:
                return {"type": "error", "note": gate.says}
            args["admits"] = min(100, sum(line.qty for line in lines))
            if gate.closes_at_ms:
                args["valid_until_ms"] = gate.closes_at_ms
        sent = await near.call(self.shop_id, self._key, "create_invoice", args)
        return {"type": "invoice", "invoice_id": invoice_id, "total": q["total"], "kind": kind, "tx_hash": sent.tx_hash,
                "lines": q["lines"], "quote_id": quote_id}


# ---------------------------------------------------------------- scripted


class ScriptedMerchant:
    """List price first; the best allowed discount once the customer asks."""

    def __init__(self, desk: Desk):
        self.desk = desk

    async def handle(self, msg: dict) -> dict:
        d = self.desk
        if msg["type"] == "request_quote":
            q = d.quote(msg["items"])
            if q["type"] == "quote":
                out = f"We're out of {', '.join(q['missing'])}. " if q["missing"] else ""
                q["note"] = f"{out}That comes to {fmt(q['total'])}."
            return q
        if msg["type"] == "counter":
            old = d.quotes.get(msg.get("quote_id", ""))
            if old is None:
                return {"type": "error", "note": "I don't have that quote. Ask for a new one."}
            wanted = msg.get("items") or [{"sku": line["sku"], "qty": line["qty"]} for line in old["lines"]]
            lines, _ = policy.price_request(d.items, wanted)
            bps, why = d.best_offer(lines)
            q = d.quote(wanted, bps)
            if q["type"] == "quote":
                q["note"] = (f"I can take {q['discount_bps'] / 100:g}% off for {why}: "
                             f"{fmt(q['total'])}. That's my best price." if q["discount_bps"]
                             else f"{fmt(q['total'])} is already my best price for this order.")
            return q
        if msg["type"] == "accept":
            return await d.issue_invoice(msg["quote_id"])
        return {"type": "error", "note": "I didn't understand that message."}


# ---------------------------------------------------------------- LLM (LangGraph)


class QuoteArgs(BaseModel):
    discount_percent: float = Field(description="Percent off this order, from 0 up to the maximum you were told.")
    note: str = Field(description="One short, friendly sentence to the customer's agent stating the total in KES.")


class _State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


class LlmMerchant:
    """A separate LangGraph graph from the Personal Agent's. For each incoming message the
    model decides the discount and the reply by calling `make_quote`; the desk clamps it.
    Accepting a quote needs no judgement, so the invoice is issued directly."""

    def __init__(self, desk: Desk):
        self.desk = desk
        self._fallback = ScriptedMerchant(desk)
        primary, others = llm.chat()
        tool = StructuredTool.from_function(func=lambda **_: None, name="make_quote", args_schema=QuoteArgs,
                                            description="Quote this order to the customer's agent.")
        self._model = primary.bind_tools([tool], tool_choice="make_quote").with_fallbacks(
            [m.bind_tools([tool], tool_choice="make_quote") for m in others])
        g = StateGraph(_State)
        g.add_node("decide", self._decide)
        g.add_edge(START, "decide")
        g.add_edge("decide", END)
        self._graph = g.compile()

    async def _decide(self, state: _State) -> dict:
        return {"messages": [await self._model.ainvoke(state["messages"])]}

    async def handle(self, msg: dict) -> dict:
        d = self.desk
        if msg["type"] == "accept":
            return await d.issue_invoice(msg["quote_id"])
        old = d.quotes.get(msg.get("quote_id", ""))
        wanted = msg.get("items") or ([{"sku": line["sku"], "qty": line["qty"]} for line in old["lines"]] if old else [])
        lines, missing = policy.price_request(d.items, wanted)
        if not lines:
            return {"type": "error", "note": f"We're out of {', '.join(missing) or 'that'}."}
        cap, why = d.best_offer(lines)
        max_pct = cap / 100
        asked = msg["type"] == "counter"
        try:
            out = await self._graph.ainvoke({"messages": [
                SystemMessage(
                    f"You are the sales agent for {d.shop_name}, a market kitchen. You talk to a customer's AI agent. "
                    f"Prices are fixed by the owner. For this order you may give between 0 and {max_pct:g} percent off"
                    f"{', because the owner allows it for ' + why if why else ''}. If you give a discount, say that reason. "
                    "Give no discount unless the customer's agent asks for a better price. When asked, larger orders "
                    "and group orders earn more of the allowed discount. Be brief and warm. Amounts are in Kenyan shillings (KES)."),
                HumanMessage(json.dumps({
                    "customer_message": msg.get("note", ""), "asked_for_better_price": asked,
                    "order": [{"name": line.name, "qty": line.qty, "unit_price_kes": policy.shillings(line.unit_price)} for line in lines],
                    "subtotal_kes": policy.shillings(policy.subtotal(lines)), "group_order": d.is_group,
                    "out_of_stock": missing,
                })),
            ]})
            args = out["messages"][-1].tool_calls[0]["args"]
            bps = round(float(args.get("discount_percent", 0)) * 100) if asked else 0
            q = d.quote(wanted, bps)
            # The model's sentence may quote a total it computed itself. Ours is the one that counts.
            q["note"] = self._note(q, str(args.get("note", "")), asked)
            return q
        except Exception:
            return await self._fallback.handle(msg)

    @staticmethod
    def _note(q: dict, said: str, asked: bool) -> str:
        """Use the model's sentence only if it states our total. Otherwise say it plainly."""
        total, said = fmt(q["total"]), said.strip()
        if said and total in said:
            return said
        warm = f"{said.rstrip('.!')}. " if said and not any(ch.isdigit() for ch in said) else ""
        if not asked:
            return f"{warm}That comes to {total}."
        if q["discount_bps"]:
            return f"{warm}I can take {q['discount_bps'] / 100:g}% off: {total}."
        return f"{warm}{total} is already my best price for this order."


def make_merchant(desk: Desk, fixed_prices: bool = False):
    """Fixed-price sales (gate tickets) need no judgement, so they skip the LLM and stay fast."""
    return LlmMerchant(desk) if settings.llm_enabled and not fixed_prices else ScriptedMerchant(desk)
