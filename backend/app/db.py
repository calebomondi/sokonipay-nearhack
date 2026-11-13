"""Postgres tables. Money is never stored here: balances, limits, invoices and receipts
are read from the contract. This holds who people are, what shops sell, and what happened."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, MetaData, String, Text, UniqueConstraint, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import settings

# Supabase's transaction pooler can't keep prepared statements between transactions.
engine = create_async_engine(
    settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5,
    connect_args={"prepare_threshold": None},
)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    metadata = MetaData(schema=settings.db_schema)


def now() -> datetime:
    return datetime.now(UTC)


def utc(dt: datetime) -> datetime:
    """Times come back from Postgres without a zone on some columns. They are all UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def ms(dt: datetime) -> int:
    return int(utc(dt).timestamp() * 1000)


class Account(Base):
    """A NEAR account SokoniPay holds for someone. One Google user can have a customer
    account and a merchant account."""

    __tablename__ = "accounts"
    # One customer account per person (kept so in code). A person may own several shops, each its own account.

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(index=True)  # Supabase user; None for seeded demo accounts
    role: Mapped[str] = mapped_column(String(16))  # customer | merchant | supplier
    near_id: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str | None] = mapped_column(String(160))
    # Encrypted with KEY_VAULT_SECRET. The full key signs only what the person does themselves.
    full_key_enc: Mapped[str] = mapped_column(Text)
    # The only key an agent is ever given.
    agent_key_enc: Mapped[str] = mapped_column(Text)
    # The limits as the person typed them, in shillings, with the dollar amounts they became onchain.
    # Shown back as typed, so a moving exchange rate doesn't turn 20,000 into 20,010.
    limits_kes: Mapped[dict | None] = mapped_column(JSON)
    # False until every onchain setup step has succeeded. Setup resumes where it stopped.
    ready: Mapped[bool] = mapped_column(default=False)
    is_demo: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=now)


class Shop(Base):
    __tablename__ = "shops"

    near_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    blurb: Mapped[str] = mapped_column(String(200), default="")
    place: Mapped[str] = mapped_column(String(120), default="")
    # {"tiers":[{"min":micro,"bps":int}], "group_bps":int, "presence_for_table":bool, "max_cost_markup":float}
    rules: Mapped[dict] = mapped_column(JSON)
    supplier_near_id: Mapped[str | None] = mapped_column(String(64))
    listed: Mapped[bool] = mapped_column(default=True)
    # venue: sells entry tickets at a gate. food: a stall with a menu, stock and a supplier.
    # counter: no price list; the cashier keys in each amount (petrol station, kiosk, barber).
    kind: Mapped[str] = mapped_column(String(12), default="food", server_default="food")
    # pending: waiting for an admin. approved: verified onchain and visible. suspended: taken down.
    status: Mapped[str] = mapped_column(String(12), default="pending", server_default="approved")
    # {"open": "06:00", "close": "18:30", "tz": "Africa/Nairobi"}. Tickets stop working at closing time.
    hours: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=now)


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("shop_near_id", "sku"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_near_id: Mapped[str] = mapped_column(ForeignKey(Shop.near_id, ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[int] = mapped_column(BigInteger)  # micro sUSD when the item was last saved; live prices come from price_kes
    price_kes: Mapped[int | None] = mapped_column()  # what the owner charges, in whole shillings
    tags: Mapped[list] = mapped_column(JSON, default=list)  # main | side | drink | meat | veg | ticket
    stock: Mapped[int] = mapped_column(default=0)
    reorder_at: Mapped[int] = mapped_column(default=0)
    restock_qty: Mapped[int] = mapped_column(default=0)
    unit_cost: Mapped[int] = mapped_column(BigInteger, default=0)  # what the supplier charges, micro sUSD


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    shop_near_id: Mapped[str] = mapped_column(String(64), index=True)
    customer_near_id: Mapped[str] = mapped_column(String(64), index=True)
    party_size: Mapped[int] = mapped_column(default=1)
    goal: Mapped[str] = mapped_column(String(300))
    mode: Mapped[str] = mapped_column(String(8))  # table | pickup | sub (a subscription renewal) | counter (bought by amount)
    # negotiating | collecting (group, waiting for shares) | paid | refunded | refused | failed
    status: Mapped[str] = mapped_column(String(16), default="negotiating")
    agent_mode: Mapped[str] = mapped_column(String(60), default="")
    invoice_id: Mapped[str | None] = mapped_column(String(64), index=True)
    kind: Mapped[str | None] = mapped_column(String(8))
    total: Mapped[int | None] = mapped_column(BigInteger)
    lines: Mapped[list | None] = mapped_column(JSON)
    events: Mapped[list] = mapped_column(JSON, default=list)
    # Written when the invoice settles: {"rate": KES per dollar, "kept": micro, "shares": [{"account_id", "amount"}]}
    settled: Mapped[dict | None] = mapped_column(JSON)
    paid_at: Mapped[datetime | None] = mapped_column()
    refunded_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)


class AgentLog(Base):
    """What a Merchant Agent did: sales, restocks, refusals."""

    __tablename__ = "agent_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_near_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # sale | restock | refused | info
    text: Mapped[str] = mapped_column(Text)
    tx_hash: Mapped[str | None] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(default=now, index=True)


class Charge(Base):
    """An amount a cashier keyed in at a counter, waiting for one customer to pay it."""

    __tablename__ = "charges"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    shop_near_id: Mapped[str] = mapped_column(String(64), index=True)
    amount_kes: Mapped[int] = mapped_column()
    note: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | paid | cancelled
    order_id: Mapped[str | None] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)


class Plan(Base):
    """Something a shop bills for on a schedule."""

    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    shop_near_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(60))
    price_kes: Mapped[int] = mapped_column()
    period_sec: Mapped[int] = mapped_column()
    active: Mapped[bool] = mapped_column(default=True)  # a retired plan takes no new subscribers
    created_at: Mapped[datetime] = mapped_column(default=now)


class Subscription(Base):
    """One person's subscription to one plan. The permission itself is on the contract."""

    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    customer_near_id: Mapped[str] = mapped_column(String(64), index=True)
    shop_near_id: Mapped[str] = mapped_column(String(64), index=True)
    plan_id: Mapped[str] = mapped_column(String(20))
    plan_name: Mapped[str] = mapped_column(String(60))
    amount: Mapped[int] = mapped_column(BigInteger)  # micro sUSD, fixed when the person subscribed
    period_sec: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(12))  # active | paused | needs_money | cancelled
    next_due: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    note: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(default=now)


class ChatThread(Base):
    """One conversation between a person and their agent. The agent remembers only the one it is in."""

    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    customer_near_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class ChatMessage(Base):
    """What a person and their agent said to each other. An order the agent ran is linked, not copied."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_near_id: Mapped[str] = mapped_column(String(64), index=True)
    thread_id: Mapped[str | None] = mapped_column(String(20), index=True)
    role: Mapped[str] = mapped_column(String(8))  # user | agent
    text: Mapped[str] = mapped_column(Text)
    order_id: Mapped[str | None] = mapped_column(String(24))
    at: Mapped[datetime] = mapped_column(default=now, index=True)


class Deposit(Base):
    """Money on its way in from another chain through NEAR Intents. `preview` deposits move nothing."""

    __tablename__ = "deposits"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    customer_near_id: Mapped[str] = mapped_column(String(64), index=True)
    mode: Mapped[str] = mapped_column(String(8))  # preview | live
    chain: Mapped[str] = mapped_column(String(40))
    symbol: Mapped[str] = mapped_column(String(16))
    asset_id: Mapped[str] = mapped_column(String(200))
    send: Mapped[str] = mapped_column(String(40))  # what the person sends, in the coin's own units
    expected: Mapped[int] = mapped_column(BigInteger)  # micro USD the quote promised
    seconds: Mapped[int] = mapped_column(default=0)
    deposit_address: Mapped[str | None] = mapped_column(String(200))
    memo: Mapped[str | None] = mapped_column(String(80))
    deadline: Mapped[str | None] = mapped_column(String(40))
    # waiting | received | converting | done | refunded | failed
    status: Mapped[str] = mapped_column(String(12), default="waiting")
    credited: Mapped[int] = mapped_column(BigInteger, default=0)  # micro sUSD added to the balance
    tx_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.db_schema}"'))
        await conn.run_sync(Base.metadata.create_all)
        # create_all never alters an existing table, so columns added later are added here.
        sch = settings.db_schema
        for ddl in (
            f"ALTER TABLE \"{sch}\".shops ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'food'",
            f"ALTER TABLE \"{sch}\".shops ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'approved'",
            f"ALTER TABLE \"{sch}\".shops ADD COLUMN IF NOT EXISTS hours JSON",
            f"ALTER TABLE \"{sch}\".items ADD COLUMN IF NOT EXISTS price_kes INTEGER",
            f"ALTER TABLE \"{sch}\".accounts DROP CONSTRAINT IF EXISTS accounts_user_id_role_key",
            f"ALTER TABLE \"{sch}\".chat_messages ADD COLUMN IF NOT EXISTS thread_id VARCHAR(20)",
            f"ALTER TABLE \"{sch}\".orders ADD COLUMN IF NOT EXISTS settled JSON",
            f"ALTER TABLE \"{sch}\".accounts ADD COLUMN IF NOT EXISTS limits_kes JSON",
            f"ALTER TABLE \"{sch}\".orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE",
            f"ALTER TABLE \"{sch}\".orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP WITH TIME ZONE",
            # Sales made before these columns existed count as paid when they were ordered.
            f"UPDATE \"{sch}\".orders SET paid_at = created_at WHERE status = 'paid' AND paid_at IS NULL",
        ):
            await conn.execute(text(ddl))


async def log(shop: str, kind: str, message: str, tx_hash: str | None = None) -> None:
    async with Session() as s:
        s.add(AgentLog(shop_near_id=shop, kind=kind, text=message, tx_hash=tx_hash))
        await s.commit()
