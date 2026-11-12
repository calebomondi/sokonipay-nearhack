"""The Merchant Agent's procurement loop.

When an item falls to its reorder point, the shop's agent asks the supplier's agent for a
price, checks it against the owner's cost cap, and pays the supplier's onchain invoice out
of the shop's revenue. It signs with the shop's function-call key, so the shop's own
onchain limits apply and the owner never has to approve each purchase."""

import asyncio
import hashlib
import secrets

from sqlalchemy import select

from app import accounts, near
from app.db import Item, Session, Shop, log
from app.policy import fmt

_busy: set[str] = set()
_tasks: set[asyncio.Task] = set()


def restock_soon(shop_id: str) -> None:
    task = asyncio.create_task(_safe(shop_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _safe(shop_id: str) -> None:
    try:
        await restock(shop_id)
    except Exception as e:
        await log(shop_id, "info", f"The restock check failed ({type(e).__name__}). It runs again after the next sale.")


async def restock(shop_id: str) -> None:
    if shop_id in _busy:
        return
    _busy.add(shop_id)
    try:
        async with Session() as s:
            shop = await s.get(Shop, shop_id)
            low = list(await s.scalars(select(Item).where(Item.shop_near_id == shop_id, Item.restock_qty > 0, Item.stock <= Item.reorder_at)))
            supplier = await s.get(Shop, shop.supplier_near_id) if shop and shop.supplier_near_id else None
        if not low or supplier is None:
            return
        shop_acct, supplier_acct = await accounts.by_near_id(shop_id), await accounts.by_near_id(supplier.near_id)
        for item in low:
            quote_unit = item.unit_cost  # the supplier's agent quotes its list price
            cap = int(item.unit_cost * shop.rules.get("max_cost_markup", 1.0))
            total = quote_unit * item.restock_qty
            if quote_unit > cap:
                await log(shop_id, "info", f"Skipped restocking {item.name}: the quote of {fmt(quote_unit)} each is above the {fmt(cap)} cap.")
                continue
            await log(shop_id, "info", f"{item.name} is down to {item.stock}. Asked {supplier.name} for {item.restock_qty} at {fmt(quote_unit)} each: {fmt(total)}.")
            po = "po-" + secrets.token_hex(5)
            try:
                await near.call(supplier_acct.near_id, accounts.agent_key(supplier_acct), "create_invoice", {
                    "id": po, "amount": str(total), "kind": "Single", "payer": shop_id, "expires_in_sec": 900,
                    "items_hash": hashlib.sha256(f"{item.sku}x{item.restock_qty}".encode()).hexdigest()})
                paid = await near.call(shop_id, accounts.agent_key(shop_acct), "pay_invoice", {"id": po})
            except near.ContractError as e:
                await log(shop_id, "refused", f"Could not restock {item.name}: {e.reason}. The owner's limit stands.", e.tx_hash)
                continue
            async with Session() as s:
                row = await s.get(Item, item.id)
                row.stock += item.restock_qty
                await s.commit()
            await log(shop_id, "restock", f"Paid {supplier.name} {fmt(total)} from revenue for {item.restock_qty} × {item.name} ({po}).", paid.tx_hash)
    finally:
        _busy.discard(shop_id)
