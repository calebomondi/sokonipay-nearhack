"""Who is calling: a Supabase access token resolved to a user."""

import time
import uuid
from dataclasses import dataclass

import httpx
from fastapi import Header, HTTPException

from app.config import settings


@dataclass(frozen=True)
class User:
    id: uuid.UUID
    email: str | None
    name: str | None


_cache: dict[str, tuple[float, User]] = {}
_TTL_S = 60


async def user_from_token(token: str) -> User | None:
    hit = _cache.get(token)
    if hit and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{settings.supabase_base_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(503, "Sign-in can't be checked right now. Try again in a moment.") from e
    if r.status_code in (401, 403):
        return None
    if r.status_code >= 400:
        raise HTTPException(503, "Sign-in can't be checked right now. Try again in a moment.")
    body = r.json()
    meta = body.get("user_metadata") or {}
    user = User(uuid.UUID(body["id"]), body.get("email"), meta.get("full_name") or meta.get("name"))
    if len(_cache) > 1000:
        _cache.clear()
    _cache[token] = (time.monotonic(), user)
    return user


async def current_user(authorization: str | None = Header(default=None)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue.")
    user = await user_from_token(authorization[7:].strip())
    if user is None:
        raise HTTPException(401, "Your session has ended. Sign in again.")
    return user
