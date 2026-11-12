"""NEAR Intents (1Click API): bring a stablecoin from another chain in as USDC on NEAR.

1Click runs on mainnet only. SokoniPay's contract is on testnet, so a deposit that settles on
mainnet is mirrored as the same amount of demo sUSD. Nothing here signs or sends anything:
the person sends the deposit from their own wallet, and we read quotes and statuses."""

import time
from datetime import UTC, datetime, timedelta

import httpx

from app.config import settings

BASE = "https://1click.chaindefuser.com/v0"
USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
STABLECOINS = {"USDC", "USDT", "USDT0", "DAI", "XDAI", "USD1", "USDF", "FRAX", "USDE", "USDG", "USDCX", "USAD"}
# Shown first, in this order; the rest follow by name.
CHAINS = {
    "eth": "Ethereum", "sol": "Solana", "base": "Base", "arb": "Arbitrum", "tron": "Tron", "bsc": "BNB Chain",
    "pol": "Polygon", "op": "Optimism", "avax": "Avalanche", "ton": "TON", "near": "NEAR", "stellar": "Stellar",
    "sui": "Sui", "aptos": "Aptos", "gnosis": "Gnosis", "scroll": "Scroll", "monad": "Monad", "bera": "Berachain",
    "xlayer": "X Layer", "plasma": "Plasma", "hypercore": "Hyperliquid", "hood": "Robinhood Chain",
    "aleo": "Aleo", "movement": "Movement", "miden": "Miden",
}
STATUS = {  # 1Click status -> ours
    "PENDING_DEPOSIT": "waiting", "KNOWN_DEPOSIT_TX": "received", "PROCESSING": "converting", "SUCCESS": "done",
    "REFUNDED": "refunded", "FAILED": "failed", "INCOMPLETE_DEPOSIT": "failed",
}

_cache: tuple[float, list[dict]] = (0.0, [])


class IntentsError(Exception):
    pass


def _headers() -> dict:
    jwt = settings.near_intents_1click_jwt
    return {"Authorization": f"Bearer {jwt}"} if jwt else {}


async def _request(method: str, path: str, **kwargs) -> dict | list:
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            res = await http.request(method, BASE + path, headers=_headers(), **kwargs)
    except httpx.HTTPError as e:
        raise IntentsError("NEAR Intents can't be reached right now. Try again in a moment.") from e
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        raise IntentsError(str(body.get("message") or "NEAR Intents could not do that.") if isinstance(body, dict) else "NEAR Intents could not do that.")
    return body


async def chains() -> list[dict]:
    """Stablecoins NEAR Intents accepts today, grouped by chain. Cached for ten minutes."""
    global _cache
    if _cache[1] and time.time() - _cache[0] < 600:
        return _cache[1]
    by_chain: dict[str, dict[str, dict]] = {}
    for t in await _request("GET", "/tokens"):
        symbol = str(t.get("symbol", ""))
        if symbol.upper() not in STABLECOINS or not 0.98 <= float(t.get("price") or 0) <= 1.02:
            continue  # also drops entries marked "(DEPRECATED)" and yield-bearing wrappers
        by_chain.setdefault(t["blockchain"], {}).setdefault(symbol, {"asset_id": t["assetId"], "symbol": symbol, "decimals": t["decimals"]})
    order = list(CHAINS)
    out = [{"id": c, "name": CHAINS.get(c, c.title()), "tokens": sorted(tokens.values(), key=lambda x: x["symbol"])}
           for c, tokens in by_chain.items()]
    out.sort(key=lambda c: (order.index(c["id"]) if c["id"] in order else len(order), c["name"]))
    _cache = (time.time(), out)
    return out


async def find(asset_id: str) -> tuple[dict, dict]:
    for chain in await chains():
        for token in chain["tokens"]:
            if token["asset_id"] == asset_id:
                return chain, token
    raise IntentsError("That coin isn't available. Pick one from the list.")


async def quote(asset_id: str, usd_micro: int, refund_to: str | None = None) -> dict:
    """What it costs to bring `usd_micro` (6 decimals) of a stablecoin in as USDC on NEAR.

    Without `refund_to` this only asks for a price. With it, the quote is committed and returns
    the address to send to; it then needs the treasury account that receives the USDC."""
    chain, token = await find(asset_id)
    live = refund_to is not None
    if live and not settings.intents_treasury:
        raise IntentsError("Real deposits are switched off on this server.")
    d = token["decimals"]
    amount = usd_micro * 10 ** (d - 6) if d >= 6 else usd_micro // 10 ** (6 - d)
    body = {
        "dry": not live, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
        "originAsset": asset_id, "destinationAsset": USDC_ON_NEAR, "amount": str(amount),
        "depositType": "ORIGIN_CHAIN", "recipientType": "DESTINATION_CHAIN",
        "depositMode": "MEMO" if chain["id"] == "stellar" else "SIMPLE",
        "recipient": settings.intents_treasury or "intents.near",
        # A price check has no one to refund, so it names a NEAR account, which is valid for every origin chain.
        "refundTo": refund_to or "intents.near", "refundType": "ORIGIN_CHAIN" if live else "INTENTS",
        "deadline": (datetime.now(UTC) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "referral": "sokonipay",
    }
    q = (await _request("POST", "/quote", json=body))["quote"]
    return {
        "chain": chain["id"], "chain_name": chain["name"], "symbol": token["symbol"],
        "send": q["amountInFormatted"], "receive": int(q["amountOut"]), "least": int(q.get("minAmountOut") or q["amountOut"]),
        "fee": max(0, usd_micro - int(q["amountOut"])), "seconds": int(q.get("timeEstimate") or 0),
        "deposit_address": q.get("depositAddress"), "memo": q.get("depositMemo"), "deadline": q.get("deadline"),
    }


async def payout_quote(asset_id: str, usd_micro: int) -> dict:
    """A price check for the way out: `usd_micro` of USDC on NEAR becomes how much of a coin on another chain.
    Never committed: SokoniPay's dollars are on testnet, so no real coins can be sent from here."""
    chain, token = await find(asset_id)
    body = {
        "dry": True, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
        "originAsset": USDC_ON_NEAR, "destinationAsset": asset_id, "amount": str(usd_micro),
        "depositType": "ORIGIN_CHAIN", "depositMode": "SIMPLE",
        # No real recipient for a price check: a NEAR account is valid whatever the destination chain.
        "recipient": "intents.near", "recipientType": "INTENTS", "refundTo": "intents.near", "refundType": "INTENTS",
        "deadline": (datetime.now(UTC) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "referral": "sokonipay",
    }
    q = (await _request("POST", "/quote", json=body))["quote"]
    got = float(q.get("amountOutUsd") or 0)
    return {"chain": chain["id"], "chain_name": chain["name"], "symbol": token["symbol"], "receive": q["amountOutFormatted"],
            "fee": max(0, usd_micro - round(got * 1_000_000)) if got else 0, "seconds": int(q.get("timeEstimate") or 0)}


async def status(deposit_address: str, memo: str | None) -> tuple[str, int | None]:
    """(our status, USDC that arrived on NEAR in micro units once done)."""
    params = {"depositAddress": deposit_address, **({"depositMemo": memo} if memo else {})}
    r = await _request("GET", "/status", params=params)
    out = (r.get("swapDetails") or {}).get("amountOut")
    return STATUS.get(r.get("status", ""), "waiting"), int(out) if out else None
