"""Event configuration and guide content.

Both live as editable JSON in data/ so a non-programmer can change the event
name, date, prizes, or guide copy without touching code. Defaults are written
to disk the first time the app starts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "name": "The Christmas Thing",
    "tagline": "One roof, too many cookies, and a QR code that knows you're here.",
    "date": "2026-12-19",
    "time": "18:30",
    "venue": "The Workshop — 4th floor",
    "rsvp_deadline": "2026-12-12",
    "public_base_url": "",
    "prizes": [
        "Grand prize — noise-cancelling headphones",
        "Second prize — cosy blanket + hot chocolate kit",
        "Third prize — board game bundle",
        "Spot prize — Christmas hamper",
        "Spot prize — bookstore gift card",
    ],
}

DEFAULT_GUIDES: list[dict[str, Any]] = [
    {
        "id": "check-in",
        "title": "Arrival & QR check-in",
        "icon": "ticket",
        "summary": "How the ticket works and what the door looks like.",
        "sections": [
            {
                "heading": "Your ticket is the QR code",
                "body": [
                    "Register on this site and you get a ticket page with a QR code. That code is your name in the system — no paper list, no clipboard.",
                    "Screenshot it, add it to your wallet app, or keep the ticket page open. The desk can also look you up by name or ticket ID if your phone dies.",
                ],
            },
            {
                "heading": "At the door",
                "body": [
                    "The desk scans your QR with the Scan page. You'll hear a chime and see your name turn green, which means the Excel sheet has been updated.",
                    "Already scanned? A second scan shows 'already checked in' with the original time so nobody gets counted twice.",
                ],
            },
            {
                "heading": "If the camera is being difficult",
                "body": [
                    "Read out the ticket ID (the CT-XXXX-XXXX code under the QR) and the desk can type it in. Same result, ten seconds slower.",
                ],
            },
        ],
    },
    {
        "id": "schedule",
        "title": "Schedule",
        "icon": "clock",
        "summary": "Doors, dinner, games, and the draw.",
        "sections": [
            {
                "heading": "The evening, roughly",
                "body": [
                    "18:30 — Doors and check-in. Mulled wine and something sparkling for the non-drinkers.",
                    "19:15 — Welcome, housekeeping, and the annual apology about the heating.",
                    "19:45 — Buffet opens. Dietary labels on every dish.",
                    "20:45 — Games and the ridiculously competitive quiz.",
                    "21:30 — Lucky draw. You must be checked in and in the room to win.",
                    "22:30 — Last songs, coat check chaos, goodnights.",
                ],
            }
        ],
    },
    {
        "id": "bring",
        "title": "What to bring",
        "icon": "gift",
        "summary": "The short list, plus the secret santa rule.",
        "sections": [
            {
                "heading": "The list",
                "body": [
                    "Your QR ticket, or your ticket ID if you're travelling light.",
                    "One wrapped secret santa gift, under £20 / $25. Anything goes except live animals and things that need batteries not included.",
                    "A warm layer — the balcony is beautiful and absolutely freezing.",
                    "An appetite. The kitchen has over-committed again.",
                ],
            }
        ],
    },
    {
        "id": "food",
        "title": "Food & dietary",
        "icon": "plate",
        "summary": "How we're handling allergies and preferences.",
        "sections": [
            {
                "heading": "Telling us early",
                "body": [
                    "The registration form has a Dietary field. Whatever you type lands in the Excel sheet, and the kitchen gets a printed copy the day before.",
                    "Nut-free, gluten-free, vegan, halal, and 'I will eat anything except mushrooms' are all normal requests here.",
                ],
            },
            {
                "heading": "On the night",
                "body": [
                    "Every dish has a label listing the main allergens. If something is unclear, ask any volunteer in a green lanyard — they have the full ingredient sheet.",
                ],
            },
        ],
    },
    {
        "id": "draw",
        "title": "Lucky draw rules",
        "icon": "sparkle",
        "summary": "Fair, transparent, and written down.",
        "sections": [
            {
                "heading": "The rules",
                "body": [
                    "One entry per person, and only for people who have scanned in. The draw reads directly from the Attendees sheet.",
                    "A person can only win once, so we keep drawing until we find a fresh name.",
                    "Winners are logged on the Winners sheet with a timestamp. No retroactive edits, no 'I was in the bathroom'.",
                    "If a winner isn't in the room after a thirty-second call, we redraw. The prize stays in the building.",
                ],
            },
            {
                "heading": "The prizes",
                "body": [
                    "The prize list is editable in data/event.json, and the draw page lets the host pick which prize is up next.",
                ],
            },
        ],
    },
    {
        "id": "rules",
        "title": "House rules",
        "icon": "heart",
        "summary": "Short, and mostly about being decent.",
        "sections": [
            {
                "heading": "The essentials",
                "body": [
                    "Be kind to the volunteers. They gave up their Friday.",
                    "Ask before photographing people, and respect anyone wearing a red 'no photos' sticker.",
                    "The quiet room on the 2nd floor is genuinely quiet — use it.",
                    "Anything breakable is probably borrowed. Please don't.",
                ],
            }
        ],
    },
    {
        "id": "contact",
        "title": "Contact & lost property",
        "icon": "phone",
        "summary": "Who to grab, and where your scarf went.",
        "sections": [
            {
                "heading": "During the event",
                "body": [
                    "Find anyone in a green lanyard, or come to the desk by the entrance.",
                ],
            },
            {
                "heading": "Afterwards",
                "body": [
                    "Lost property lives in the box office until the end of January. Email events@example.com with a description and we'll dig through the scarf pile.",
                ],
            },
        ],
    },
]


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _write_default(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class EventConfig:
    """Event metadata + guide content, read from data/ on each access."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.config_path = self.data_dir / "event.json"
        self.guides_path = self.data_dir / "guides.json"
        _write_default(self.config_path, DEFAULT_CONFIG)
        _write_default(self.guides_path, DEFAULT_GUIDES)

    def config(self) -> dict[str, Any]:
        merged = dict(DEFAULT_CONFIG)
        merged.update(_read_json(self.config_path, {}))
        return merged

    def guides(self) -> list[dict[str, Any]]:
        guides = _read_json(self.guides_path, DEFAULT_GUIDES)
        return guides if isinstance(guides, list) else DEFAULT_GUIDES
