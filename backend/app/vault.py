"""Encrypts NEAR keys at rest and makes new ones."""

import base58
from cryptography.fernet import Fernet
from nacl.signing import SigningKey

from app.config import settings


def _fernet() -> Fernet:
    if not settings.key_vault_secret:
        raise RuntimeError("KEY_VAULT_SECRET is not set")
    return Fernet(settings.key_vault_secret.encode())


def seal(private_key: str) -> str:
    return _fernet().encrypt(private_key.encode()).decode()


def unseal(sealed: str) -> str:
    return _fernet().decrypt(sealed.encode()).decode()


def new_keypair() -> tuple[str, str]:
    """(public, private) in NEAR's `ed25519:<base58>` form."""
    sk = SigningKey.generate()
    public = bytes(sk.verify_key)
    return (
        "ed25519:" + base58.b58encode(public).decode(),
        "ed25519:" + base58.b58encode(bytes(sk) + public).decode(),
    )


def public_of(private_key: str) -> str:
    raw = base58.b58decode(private_key.replace("ed25519:", ""))
    return "ed25519:" + base58.b58encode(bytes(SigningKey(raw[:32]).verify_key)).decode()
