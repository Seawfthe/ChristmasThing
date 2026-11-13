"""Unit tests for admin password verification + sessions."""

from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import SessionStore, hash_password, verify_password  # noqa: E402


def config_for(password: str) -> dict:
    return {"admin": {"password": hash_password(password, iterations=100_000)}}


class PasswordTests(unittest.TestCase):
    def test_correct_password_passes(self) -> None:
        config = config_for("correct-horse-battery")
        self.assertTrue(verify_password("correct-horse-battery", config))

    def test_wrong_password_fails(self) -> None:
        config = config_for("correct-horse-battery")
        self.assertFalse(verify_password("Correct-Horse-Battery", config))
        self.assertFalse(verify_password("", config))
        self.assertFalse(verify_password("wrong-horse-battery", config))

    def test_malformed_config_is_rejected(self) -> None:
        self.assertFalse(verify_password("x", {}))
        self.assertFalse(verify_password("x", {"admin": {}}))
        self.assertFalse(
            verify_password(
                "x", {"admin": {"password": {"iterations": 10, "salt": "00", "hash": "00"}}}
            )
        )
        self.assertFalse(
            verify_password(
                "x", {"admin": {"password": {"iterations": 100_000, "salt": "zz", "hash": "00"}}}
            )
        )

    def test_hash_is_salted(self) -> None:
        first = hash_password("same-password", iterations=100_000)
        second = hash_password("same-password", iterations=100_000)
        self.assertNotEqual(first["salt"], second["salt"])
        self.assertNotEqual(first["hash"], second["hash"])
        self.assertNotIn("same-password", str(first))


class SessionTests(unittest.TestCase):
    def test_create_and_validate(self) -> None:
        sessions = SessionStore(ttl_minutes=1)
        token, ttl = sessions.create()
        self.assertTrue(token)
        self.assertEqual(ttl, 60)
        self.assertTrue(sessions.valid(token))

    def test_unknown_and_missing_tokens(self) -> None:
        sessions = SessionStore()
        self.assertFalse(sessions.valid(None))
        self.assertFalse(sessions.valid("nope"))

    def test_destroy(self) -> None:
        sessions = SessionStore()
        token, _ = sessions.create()
        sessions.destroy(token)
        self.assertFalse(sessions.valid(token))

    def test_expiry(self) -> None:
        sessions = SessionStore(ttl_minutes=1)
        token, _ = sessions.create()
        sessions._sessions[token] = time.time() - 1  # force expiry
        self.assertFalse(sessions.valid(token))

    def test_tokens_are_unique(self) -> None:
        sessions = SessionStore()
        tokens = {sessions.create()[0] for _ in range(20)}
        self.assertEqual(len(tokens), 20)


if __name__ == "__main__":
    unittest.main()
