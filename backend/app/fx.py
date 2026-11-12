"""Shillings. Shops price in KES and people read KES; the contract settles in dollars (sUSD).

One live rate, refreshed hourly, converts between the two. If the rate service is down the last
rate is kept, and before any rate has loaded a fixed one is used so nothing stops working."""

import time

import httpx

MICRO = 1_000_000
_rate, _at = 129.0, 0.0  # KES per US dollar


async def refresh() -> float:
    global _rate, _at
    if time.time() - _at > 3600:
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                _rate = float((await http.get("https://open.er-api.com/v6/latest/USD")).json()["rates"]["KES"])
        except Exception:
            pass  # keep the last rate
        _at = time.time()
    return _rate


def rate() -> float:
    return _rate


def to_micro(kes: float) -> int:
    """Shillings to micro sUSD, at the current rate."""
    return round(kes / _rate * MICRO)


def to_kes(micro: int, at: float | None = None) -> float:
    return micro * (at or _rate) / MICRO


def say(micro: int) -> str:
    """How an amount is written for people: KES 1,274."""
    return f"KES {round(to_kes(micro)):,}"
