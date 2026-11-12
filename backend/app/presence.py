"""Rotating presence code shown as a QR on the shop's screen.

token = window.hmac(secret, shop|window). A window is 10 s and the current and two
previous windows are accepted. It proves the customer saw the shop's screen just now,
without collecting any location."""

import hashlib
import hmac
import time

from app.config import settings

WINDOW_S = 10


def _sign(shop: str, window: int) -> str:
    return hmac.new(settings.presence_qr_secret.encode(), f"{shop}|{window}".encode(), hashlib.sha256).hexdigest()[:16]


def _b36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


def token(shop: str, at: float | None = None) -> dict:
    at = time.time() if at is None else at
    window = int(at // WINDOW_S)
    return {"token": f"{_b36(window)}.{_sign(shop, window)}", "expires_in_ms": int((WINDOW_S - at % WINDOW_S) * 1000)}


def verify(shop: str, tok: str | None, at: float | None = None) -> bool:
    if not tok or "." not in tok:
        return False
    w36, mac = tok.split(".", 1)
    try:
        window = int(w36, 36)
    except ValueError:
        return False
    current = int((time.time() if at is None else at) // WINDOW_S)
    if window > current or current - window > 2:
        return False
    return hmac.compare_digest(mac, _sign(shop, window))
