"""Creates and looks up the NEAR accounts SokoniPay holds for people.

Custody, plainly: the backend keeps each account's full-access key, encrypted. It signs
with that key only for things the person does themselves (setup, changing limits, top-up).
Agents are handed the function-call key and nothing else."""

import asyncio
import re
import secrets
import uuid

from sqlalchemy import select

from app import fx, near, vault
from app.auth import User
from app.config import settings
from app.db import Account, Item, Session, Shop

# What a new food stall starts with. No discounts: prices are final until the owner adds a rule in the console.
DEFAULT_RULES = {
    "discounts": [],
    "presence_for_table": True,
    "max_cost_markup": 1.1,
}


_locks: dict[tuple[uuid.UUID, str], asyncio.Lock] = {}


def slug(text: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:20].strip("-")
    return s or fallback


async def get(user_id: uuid.UUID, role: str) -> Account | None:
    async with Session() as s:
        return await s.scalar(select(Account).where(Account.user_id == user_id, Account.role == role).order_by(Account.created_at))


class TooManyShops(Exception):
    pass


MAX_SHOPS = 5  # each one is a NEAR account we pay to create


async def shops_of(user_id: uuid.UUID) -> list[Account]:
    """Every shop a person owns, oldest first."""
    async with Session() as s:
        return list(await s.scalars(select(Account).where(Account.user_id == user_id, Account.role == "merchant").order_by(Account.created_at)))


async def by_near_id(near_id: str) -> Account | None:
    async with Session() as s:
        return await s.scalar(select(Account).where(Account.near_id == near_id))


def agent_key(account: Account) -> str:
    return vault.unseal(account.agent_key_enc)


def full_key(account: Account) -> str:
    return vault.unseal(account.full_key_enc)


async def _new_near_id(base: str) -> str:
    for _ in range(5):
        near_id = f"{base}-{secrets.token_hex(2)}.{settings.contract_id}"
        if not await near.account_exists(near_id):
            return near_id
    raise RuntimeError("could not find a free account name")


async def _create(user: User, role: str, display: str, name_hint: str) -> Account:
    near_id = await _new_near_id(slug(name_hint, role))
    full_pub, full_priv = vault.new_keypair()
    _agent_pub, agent_priv = vault.new_keypair()
    await near.create_account(near_id, full_pub)
    account = Account(
        user_id=user.id, role=role, near_id=near_id, name=display[:80], email=user.email,
        full_key_enc=vault.seal(full_priv), agent_key_enc=vault.seal(agent_priv),
    )
    async with Session() as s:
        s.add(account)
        await s.commit()
    return account


async def _finish(account: Account) -> Account:
    """Run whatever onchain setup is still missing. Safe to call again after a failure."""
    fk, methods = full_key(account), near.CUSTOMER_AGENT_METHODS
    await near.refill_gas(account.near_id)
    if account.role == "merchant":
        methods = near.MERCHANT_AGENT_METHODS
        if await near.view("get_merchant", {"account_id": account.near_id}) is None:
            await near.register_merchant(account.near_id, fk, account.name)  # unverified until an admin approves
        per_payment, per_day = settings.shop_per_payment, settings.shop_per_day
    else:
        if int(await near.view("get_balance", {"account_id": account.near_id})) == 0:
            await near.fund_susd(account.near_id, fk, settings.welcome_susd)
        per_payment, per_day = settings.default_per_payment, settings.default_per_day
    if await near.view("get_limits", {"account_id": account.near_id}) is None:
        await near.set_limits(account.near_id, fk, per_payment, per_day)
    try:
        await near.add_agent_key(account.near_id, fk, vault.public_of(agent_key(account)), methods)
    except near.ContractError as e:
        if "already" not in e.reason.lower() and "exist" not in e.reason.lower():
            raise
    async with Session() as s:
        row = await s.get(Account, account.id)
        row.ready = True
        await s.commit()
        return row


async def setup_customer(user: User) -> Account:
    """First sign-in: a NEAR account, 50 demo sUSD deposited, 20/40 limits, and an agent key."""
    async with _locks.setdefault((user.id, "customer"), asyncio.Lock()):
        account = await get(user.id, "customer")
        if account is None:
            display = user.name or (user.email or "customer").split("@")[0]
            account = await _create(user, "customer", display, display.split(" ")[0])
        return account if account.ready else await _finish(account)


async def setup_shop(user: User, kind: str, name: str, place: str, blurb: str, hours: dict | None, items: list[dict]) -> Account:
    """Opens a shop with what the owner entered: a NEAR account, on the onchain register (unverified),
    an agent key with limits. It stays pending, and invisible to customers, until an admin approves it."""
    async with _locks.setdefault((user.id, "merchant"), asyncio.Lock()):
        mine = await shops_of(user.id)
        account = next((a for a in mine if not a.ready), None)  # a setup that stopped half-way is finished first
        if account is None:
            if len(mine) >= MAX_SHOPS:
                raise TooManyShops
            account = await _create(user, "merchant", name, name)
            async with Session() as s:
                s.add(Shop(near_id=account.near_id, name=name[:80], blurb=blurb[:200], place=place[:120], kind=kind,
                           status="pending", hours=hours, rules=DEFAULT_RULES if kind == "food" else {"discounts": []},
                           supplier_near_id=None))
                await s.flush()  # the shop row must exist before its items
                s.add_all(new_items(account.near_id, kind, items))
                await s.commit()
        return account if account.ready else await _finish(account)


def new_items(shop_id: str, kind: str, items: list[dict], taken: set[str] | None = None) -> list[Item]:
    """Turn what the owner typed into catalog rows. Tickets never run out; food gets stock the agent restocks."""
    taken = set(taken or ())
    out = []
    for it in items:
        base = slug(it["name"], "item")
        sku, n = base, 2
        while sku in taken:
            sku, n = f"{base}-{n}", n + 1
        taken.add(sku)
        kes = int(it["price_kes"])
        price = fx.to_micro(kes)
        if kind == "counter":
            # A counter's price list: what one unit costs, so the shop's agent can work out what an amount buys.
            unit = " ".join(str(it.get("unit") or "").lower().split())[:12]
            tags = ["counter"] + ([f"unit:{unit}"] if unit else []) + (["whole"] if it.get("whole") or not unit else [])
            out.append(Item(shop_near_id=shop_id, sku=sku, name=it["name"][:80], price=price, price_kes=kes, tags=tags, stock=100_000))
        elif kind == "venue":
            out.append(Item(shop_near_id=shop_id, sku=sku, name=it["name"][:80], price=price, price_kes=kes, tags=["ticket"], stock=100_000))
        else:
            out.append(Item(shop_near_id=shop_id, sku=sku, name=it["name"][:80], price=price, price_kes=kes, tags=[it.get("category") or "main"],
                            stock=20, reorder_at=5, restock_qty=10, unit_cost=price // 4))
    return out
