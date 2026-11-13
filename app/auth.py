"""Admin authentication for the Python build.

PBKDF2-SHA256 verification against the hash in data/event.json, plus a small
in-memory session store. Sessions are process-local: restarting the server
signs everyone out, which is fine for a one-night event.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from typing import Any

MIN_ITERATIONS = 100_000
TOKEN_BYTES = 32


def hash_password(
    password: str, *, iterations: int = 210_000, salt: bytes | None = None
) -> dict[str, Any]:
    """Create the same structure scripts/set_admin_password.py writes."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    return {
        "algo": "pbkdf2-sha256",
        "iterations": iterations,
        "salt": salt.hex(),
        "hash": digest.hex(),
    }


def verify_password(password: str, event_config: dict[str, Any]) -> bool:
    """Constant-time check of a password against the event config."""
    admin = (event_config or {}).get("admin") or {}
    password_config = admin.get("password") or {}
    try:
        iterations = int(password_config.get("iterations") or 0)
        salt = bytes.fromhex(str(password_config.get("salt") or ""))
        expected = bytes.fromhex(str(password_config.get("hash") or ""))
    except (TypeError, ValueError):
        return False

    if not password or not salt or not expected or iterations < MIN_ITERATIONS:
        return False
    if password_config.get("algo", "pbkdf2-sha256") != "pbkdf2-sha256":
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=len(expected)
    )
    return hmac.compare_digest(digest, expected)


class SessionStore:
    """Thread-safe token → expiry map."""

    def __init__(self, ttl_minutes: int = 720) -> None:
        self.ttl = max(1, int(ttl_minutes)) * 60
        self._lock = threading.Lock()
        self._sessions: dict[str, float] = {}

    def create(self) -> tuple[str, int]:
        token = secrets.token_urlsafe(TOKEN_BYTES)
        expires = time.time() + self.ttl
        with self._lock:
            self._purge_locked()
            self._sessions[token] = expires
        return token, self.ttl

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        now = time.time()
        with self._lock:
            expires = self._sessions.get(token)
            if expires is None:
                return False
            if expires <= now:
                self._sessions.pop(token, None)
                return False
            return True

    def destroy(self, token: str | None) -> None:
        if not token:
            return
        with self._lock:
            self._sessions.pop(token, None)

    def _purge_locked(self) -> None:
        now = time.time()
        expired = [token for token, expiry in self._sessions.items() if expiry <= now]
        for token in expired:
            self._sessions.pop(token, None)
