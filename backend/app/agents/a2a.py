"""The only way the two agents talk. They share no memory, tools or keys: the Personal
Agent sends a message, the Merchant Agent answers. Every message is recorded on the order.

Customer -> shop:  request_quote {items:[{sku,qty}], note}
                   counter       {quote_id, note}
                   accept        {quote_id}
Shop -> customer:  quote   {quote_id, lines, subtotal, discount_bps, total, missing, note}
                   invoice {invoice_id, total, kind, tx_hash, lines}
                   error   {note}
"""

from collections.abc import Awaitable, Callable

Emit = Callable[[dict], Awaitable[None]]
Handler = Callable[[dict], Awaitable[dict]]


class Channel:
    def __init__(self, customer_label: str, shop_label: str, to_shop: Handler, emit: Emit):
        self.customer_label, self.shop_label = customer_label, shop_label
        self._to_shop, self._emit = to_shop, emit

    async def send(self, message: dict) -> dict:
        await self._emit({"t": "msg", "from": "personal", "who": self.customer_label, "kind": message["type"],
                          "text": message.get("note", ""), "lines": message.get("lines")})
        reply = await self._to_shop(message)
        if reply["type"] == "invoice":
            await self._emit({"t": "tx", "who": self.shop_label, "label": "Invoice issued onchain", "hash": reply["tx_hash"]})
            await self._emit({"t": "invoice", "id": reply["invoice_id"], "total": reply["total"], "kind": reply["kind"], "lines": reply["lines"]})
        else:
            await self._emit({"t": "msg", "from": "merchant", "who": self.shop_label, "kind": reply["type"],
                              "text": reply.get("note", ""), "lines": reply.get("lines"), "total": reply.get("total"),
                              "discount_bps": reply.get("discount_bps")})
        return reply
