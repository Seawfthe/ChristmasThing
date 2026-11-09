"""Event rules.

This is the layer that knows how an event works: what a valid registration
looks like, what "checked in" means, and how the lucky draw stays fair. It
depends on the store, never the other way round.
"""

from __future__ import annotations

import random
import re
import secrets
from datetime import datetime
from typing import Any

from .store import STATUS_PRESENT, STATUS_REGISTERED, ExcelStore, StoreError

TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I, O, 0, 1
TICKET_RE = re.compile(r"CT-[A-Z0-9]{4}-[A-Z0-9]{4}", re.IGNORECASE)
LOOSE_RE = re.compile(r"\b[A-Z0-9]{8}\b", re.IGNORECASE)

ROLES = {"Guest", "Organiser", "Volunteer", "Performer", "Plus one"}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def now_stamp() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")


def new_ticket_code(taken: set[str]) -> str:
    while True:
        raw = "".join(secrets.choice(TICKET_ALPHABET) for _ in range(8))
        code = f"CT-{raw[:4]}-{raw[4:]}"
        if code not in taken:
            return code


def normalise_ticket(value: str) -> str | None:
    """Pull a ticket ID out of raw scanner text, a URL, or a typed code."""
    text = (value or "").strip()
    if not text:
        return None
    match = TICKET_RE.search(text)
    if match:
        return match.group(0).upper()
    match = LOOSE_RE.search(text)
    if match:
        raw = match.group(0).upper()
        return f"CT-{raw[:4]}-{raw[4:]}"
    return None


def _text(value: Any, limit: int = 200) -> str:
    return str(value).strip()[:limit] if value is not None else ""


class EventService:
    def __init__(self, store: ExcelStore, config_getter, guides_getter=None) -> None:
        self.store = store
        self._config = config_getter
        self._guides = guides_getter or (lambda: [])

    # ------------------------------------------------------------------ reads
    def config(self) -> dict[str, Any]:
        return self._config()

    def guides(self) -> list[dict[str, Any]]:
        return self._guides()

    def bootstrap(self) -> dict[str, Any]:
        return {
            "event": self.config(),
            "guides": self.guides(),
            "stats": self.stats(),
            "recent": self.recent_check_ins(limit=5),
            "statuses": {"registered": STATUS_REGISTERED, "present": STATUS_PRESENT},
        }

    def attendees(self, query: str = "", status: str = "") -> list[dict[str, str]]:
        rows = self.store.attendees()
        needle = query.strip().casefold()
        wanted = status.strip().casefold()
        if needle:
            rows = [
                row
                for row in rows
                if needle in " ".join(str(v) for v in row.values()).casefold()
            ]
        if wanted and wanted not in ("all", "any"):
            if wanted == "present":
                rows = [row for row in rows if row.get("status") == STATUS_PRESENT]
            elif wanted == "pending":
                rows = [row for row in rows if row.get("status") != STATUS_PRESENT]
            else:
                rows = [row for row in rows if row.get("status", "").casefold() == wanted]
        rows.sort(key=lambda row: row.get("name", "").casefold())
        return rows

    def stats(self) -> dict[str, Any]:
        rows = self.store.attendees()
        present = [row for row in rows if row.get("status") == STATUS_PRESENT]
        winners = self.store.winners()
        return {
            "registered": len(rows),
            "checked_in": len(present),
            "pending": len(rows) - len(present),
            "prizes_awarded": len(winners),
            "check_in_rate": round(len(present) / len(rows) * 100) if rows else 0,
            "last_check_in": present[-1]["name"] if present else "",
        }

    def recent_check_ins(self, limit: int = 8) -> list[dict[str, str]]:
        present = [row for row in self.store.attendees() if row.get("status") == STATUS_PRESENT]
        present.sort(key=lambda row: row.get("checked_in_at", ""), reverse=True)
        return [
            {
                "ticket_id": row.get("ticket_id", ""),
                "name": row.get("name", ""),
                "checked_in_at": row.get("checked_in_at", ""),
            }
            for row in present[:limit]
        ]

    def ticket(self, code: str) -> dict[str, str] | None:
        normalised = normalise_ticket(code)
        if normalised is None:
            return None
        return self.store.find_attendee(normalised)

    # ------------------------------------------------------------ registration
    def register(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = _text(payload.get("name"), 80)
        email = _text(payload.get("email"), 120)
        phone = _text(payload.get("phone"), 40)
        team = _text(payload.get("team"), 80)
        role = _text(payload.get("role"), 40) or "Guest"
        dietary = _text(payload.get("dietary"), 120)
        notes = _text(payload.get("notes"), 500)

        if len(name) < 2:
            raise StoreError("Please give us a name — at least two characters.", "validation")
        if email and not EMAIL_RE.match(email):
            raise StoreError("That email doesn't look quite right.", "validation")
        if role not in ROLES:
            role = "Guest"

        if email:
            existing = self.store.find_attendee_by_email(email)
            if existing:
                return {
                    "attendee": existing,
                    "already_registered": True,
                    "ticket_url": f"ticket.html?code={existing['ticket_id']}",
                }

        taken = {row.get("ticket_id", "") for row in self.store.attendees()}
        code = new_ticket_code(taken)
        record = {
            "ticket_id": code,
            "name": name,
            "email": email,
            "phone": phone,
            "team": team,
            "role": role,
            "dietary": dietary,
            "notes": notes,
            "registered_at": now_stamp(),
            "status": STATUS_REGISTERED,
            "checked_in_at": "",
            "checkin_source": "",
        }
        attendee = self.store.add_attendee(record)
        return {
            "attendee": attendee,
            "already_registered": False,
            "ticket_url": f"ticket.html?code={code}",
        }

    # ---------------------------------------------------------------- check-in
    def check_in(self, raw_code: str, source: str = "scan") -> dict[str, Any]:
        code = normalise_ticket(raw_code)
        if code is None:
            raise StoreError("That doesn't look like a ticket code.", "validation")
        attendee = self.store.find_attendee(code)
        if attendee is None:
            raise StoreError(f"No ticket found for {code}.", "not_found")
        if attendee.get("status") == STATUS_PRESENT:
            return {
                "attendee": attendee,
                "already_checked_in": True,
                "checked_in_at": attendee.get("checked_in_at", ""),
            }
        updated = self.store.update_attendee(
            code,
            {
                "status": STATUS_PRESENT,
                "checked_in_at": now_stamp(),
                "checkin_source": _text(source, 20) or "scan",
            },
        )
        return {"attendee": updated, "already_checked_in": False, "stats": self.stats()}

    def undo_check_in(self, raw_code: str) -> dict[str, Any]:
        code = normalise_ticket(raw_code)
        if code is None:
            raise StoreError("That doesn't look like a ticket code.", "validation")
        attendee = self.store.find_attendee(code)
        if attendee is None:
            raise StoreError(f"No ticket found for {code}.", "not_found")
        updated = self.store.update_attendee(
            code,
            {"status": STATUS_REGISTERED, "checked_in_at": "", "checkin_source": ""},
        )
        return {"attendee": updated, "stats": self.stats()}

    # -------------------------------------------------------------- lucky draw
    def draw(self, prize: str = "", eligible: str = "checked_in", allow_repeat: bool = False) -> dict[str, Any]:
        prize = _text(prize, 120) or "Mystery prize"
        eligible = eligible if eligible in ("checked_in", "registered") else "checked_in"

        rows = self.store.attendees()
        if eligible == "checked_in":
            pool = [row for row in rows if row.get("status") == STATUS_PRESENT]
            pool_label = "checked-in guests"
        else:
            pool = rows
            pool_label = "registered guests"

        if not allow_repeat:
            previous = {winner.get("ticket_id") for winner in self.store.winners()}
            pool = [row for row in pool if row.get("ticket_id") not in previous]

        if not pool:
            raise StoreError(
                "Nobody is eligible for this draw yet. Check guests in first.",
                "empty_pool",
            )

        winner = secrets.choice(pool)
        record = self.store.add_winner(
            ticket_id=winner["ticket_id"],
            name=winner["name"],
            prize=prize,
            drawn_at=now_stamp(),
        )
        names = [row["name"] for row in pool]
        sample = random.sample(names, min(48, len(names)))
        if winner["name"] not in sample:
            sample.append(winner["name"])
        random.shuffle(sample)
        return {
            "winner": {"ticket_id": winner["ticket_id"], "name": winner["name"], "prize": prize},
            "record": record,
            "prize": prize,
            "pool_size": len(pool),
            "pool_label": pool_label,
            "candidates": sample,
            "stats": self.stats(),
            "history": self.store.winners()[-10:],
        }

    def draw_history(self) -> dict[str, Any]:
        return {
            "winners": self.store.winners(),
            "stats": self.stats(),
        }

    def reset_draw(self) -> dict[str, Any]:
        self.store.clear_winners()
        return {"ok": True, "stats": self.stats()}
