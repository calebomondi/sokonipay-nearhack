"""The NEAR client. Every onchain read and write goes through here."""

import asyncio
import base64
import json
import re
from dataclasses import dataclass
from typing import Any

from py_near.account import Account as NearAccount

from app.config import settings

TGAS = 10**12
YOCTO_NEAR = 10**24
ONE_YOCTO = 1

# What each kind of agent key may call. Nothing here can move funds out or change authority.
CUSTOMER_AGENT_METHODS = ["pay_invoice", "contribute"]
MERCHANT_AGENT_METHODS = ["create_invoice", "pay_invoice", "redeem"]


class ContractError(Exception):
    """The chain or the contract said no. `reason` is safe to show to a person."""

    def __init__(self, reason: str, tx_hash: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.tx_hash = tx_hash


@dataclass
class Sent:
    tx_hash: str
    value: Any = None


_PANIC = re.compile(r"Smart contract panicked: ([^\"'\\}]+)")
_KNOWN = {
    "DepositWithFunctionCall": "an agent key cannot attach a deposit, so it cannot do this",
    "MethodNameMismatch": "this agent key is not allowed to call that method",
    "NotEnoughAllowance": "the agent key has used up its gas allowance",
    "NotEnoughBalance": "the account does not have enough NEAR for gas",
}


BUSY = "the NEAR test network is busy right now, so nothing was done. Try again in a moment"


def _reason(err: object) -> str:
    text = str(err) or type(err).__name__
    if "rate limit" in text.lower() or "RPC not available" in text or "429" in text:
        return BUSY  # never show a provider's raw error to someone at a till
    m = _PANIC.search(text)
    if m:
        return m.group(1).strip().rstrip(".,")
    for needle, plain in _KNOWN.items():
        if needle in text or needle == type(err).__name__:
            return plain
    return text[:240]


_accounts: dict[tuple[str, str], NearAccount] = {}
_locks: dict[str, asyncio.Lock] = {}
_reader: NearAccount | None = None


def _rpc() -> list[str]:
    return [u.strip() for u in settings.near_rpc_url.split(",") if u.strip()]


async def _account(account_id: str, private_key: str) -> NearAccount:
    key = (account_id, private_key)
    if key not in _accounts:
        acc = NearAccount(account_id, private_key, _rpc())
        await acc.startup()
        _accounts[key] = acc
    return _accounts[key]


# Reads are remembered for a few seconds. Every screen polls, and the same few facts (a balance, whether a
# shop is verified) are asked for many times a second; without this the RPC provider starts refusing us.
# Anything this server writes clears the memory first, so a screen never shows the state from before its own action.
_TTL = {"is_verified": 30.0, "get_merchant": 10.0}
_seen: dict[str, tuple[float, Any]] = {}
_asking: dict[str, asyncio.Future] = {}


def _keep_for(method: str, result: Any) -> float:
    if result is None:
        return 0.0  # "not there yet" may be about to change
    if method == "get_ticket" and result.get("admitted", 0) >= result.get("admits", 1):
        return 3600.0  # a used-up ticket never changes again
    return _TTL.get(method, 4.0)


async def view(method: str, args: dict | None = None, contract: str | None = None) -> Any:
    global _reader
    key = f"{contract or ''}|{method}|{json.dumps(args or {}, sort_keys=True)}"
    hit = _seen.get(key)
    now = asyncio.get_running_loop().time()
    if hit and hit[0] > now:
        return hit[1]
    if key in _asking:  # the same question is already on its way: share the answer
        return await asyncio.shield(_asking[key])
    fut = _asking[key] = asyncio.get_running_loop().create_future()
    try:
        if _reader is None:
            _reader = NearAccount(rpc_addr=_rpc())
            await _reader.startup()
        for attempt in range(3):
            try:
                result = (await _reader.view_function(contract or settings.contract_id, method, args or {})).result
                break
            except Exception as e:
                if attempt == 2:
                    raise ContractError(_reason(e)) from e
                await asyncio.sleep(0.5 * (attempt + 1))
        keep = _keep_for(method, result)
        if keep:
            _seen[key] = (asyncio.get_running_loop().time() + keep, result)
        fut.set_result(result)
        return result
    except BaseException as e:
        fut.set_exception(e)
        fut.exception()  # mark it read, so an unshared failure isn't logged as never retrieved
        raise
    finally:
        _asking.pop(key, None)


async def _send(account_id: str, private_key: str, do) -> Sent:
    """Run one transaction for an account. One at a time per account, so nonces never collide."""
    acc = await _account(account_id, private_key)
    async with _locks.setdefault(account_id, asyncio.Lock()):
        try:
            res = await do(acc)
        except Exception as e:  # py-near raises its own types for chain errors
            raise ContractError(_reason(e), getattr(e, "trx_hash", None)) from e
        finally:
            _seen.clear()  # whatever was read before this may now be out of date
    tx_hash = res.transaction.hash
    status = res.status or {}
    if "Failure" in status:
        raise ContractError(_reason(json.dumps(status["Failure"])), tx_hash)
    raw = status.get("SuccessValue") or ""
    value = None
    if raw:
        try:
            value = json.loads(base64.b64decode(raw))
        except ValueError:
            value = None
    return Sent(tx_hash, value)


async def call(
    account_id: str, private_key: str, method: str, args: dict, *,
    contract: str | None = None, deposit: int = 0, gas: int = 30 * TGAS,
) -> Sent:
    """Call a contract method. With an agent key, `deposit` must stay 0: the chain rejects anything else."""
    target = contract or settings.contract_id
    return await _send(account_id, private_key, lambda acc: acc.function_call(target, method, args, gas=gas, amount=deposit))


# ---------------------------------------------------------------- provisioning (root and full keys)

ROOT = settings.contract_id


async def create_account(near_id: str, public_key: str) -> Sent:
    """Create `near_id` as a sub-account of the contract account, with a little NEAR for gas."""
    amount = int(settings.new_account_near * YOCTO_NEAR)
    return await _send(ROOT, settings.root_account_key, lambda acc: acc.create_account(near_id, public_key, amount))


async def account_exists(near_id: str) -> bool:
    reader = NearAccount(near_id, rpc_addr=_rpc())
    await reader.startup()
    try:
        state = await reader.fetch_state()
        return bool(state) and "error" not in state
    except Exception:
        return False


async def near_balance(near_id: str) -> int:
    reader = NearAccount(near_id, rpc_addr=_rpc())
    await reader.startup()
    return int(await reader.get_balance())


async def refill_gas(near_id: str) -> None:
    """Keep an account able to pay for its transactions. The chain reserves a pessimistic gas
    fee up front (about 0.03 NEAR for 30 TGas), so below ~0.06 NEAR calls start to fail."""
    if await near_balance(near_id) < 6 * YOCTO_NEAR // 100:
        await _send(ROOT, settings.root_account_key, lambda acc: acc.send_money(near_id, YOCTO_NEAR // 10))


async def add_agent_key(near_id: str, full_key: str, agent_public_key: str, methods: list[str]) -> Sent:
    return await _send(
        near_id, full_key,
        lambda acc: acc.add_public_key(agent_public_key, settings.contract_id, methods, allowance=YOCTO_NEAR // 4),
    )


async def fund_susd(near_id: str, full_key: str, amount: int) -> Sent:
    """Testnet faucet: mint demo sUSD to the account, then deposit it into its SokoniPay balance."""
    await call(ROOT, settings.root_account_key, "mint", {"account_id": near_id, "amount": str(amount)}, contract=settings.token_id)
    return await call(
        near_id, full_key, "ft_transfer_call",
        {"receiver_id": settings.contract_id, "amount": str(amount), "msg": "deposit"},
        contract=settings.token_id, deposit=ONE_YOCTO, gas=45 * TGAS,
    )


async def withdraw(near_id: str, full_key: str, amount: int) -> Sent:
    """Take sUSD out of the SokoniPay balance to the person's own NEAR account. Needs the full key."""
    return await call(near_id, full_key, "withdraw", {"amount": str(amount)}, deposit=ONE_YOCTO, gas=80 * TGAS)


async def set_limits(near_id: str, full_key: str, per_payment: int, per_day: int) -> Sent:
    return await call(near_id, full_key, "set_limits", {"per_payment": str(per_payment), "per_day": str(per_day)}, deposit=ONE_YOCTO)


async def register_merchant(near_id: str, full_key: str, name: str) -> Sent:
    """Put the shop on the onchain register, unverified. An admin verifies it later."""
    return await call(near_id, full_key, "register_merchant", {"name": name}, deposit=ONE_YOCTO)


async def set_verified(near_id: str, verified: bool) -> Sent:
    """Only the contract owner can do this. Customers' agents refuse to connect to an unverified shop."""
    return await call(ROOT, settings.root_account_key, "set_verified", {"merchant": near_id, "verified": verified})
