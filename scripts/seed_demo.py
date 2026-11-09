#!/usr/bin/env python3
"""Fill the guest list with a handful of demo people.

    python scripts/seed_demo.py           # 6 registered, 4 checked in
    python scripts/seed_demo.py --all-in  # everyone checked in

Handy for trying the scan desk and the lucky draw before real guests arrive.
Safe to run twice: emails are unique, so existing tickets are reused.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.service import EventService  # noqa: E402
from app.store import ExcelStore  # noqa: E402

DATA = ROOT / "data"
WORKBOOK = DATA / "attendees.xlsx"

DEMO_GUESTS = [
    ("Mira Okonkwo", "mira@example.com", "Engine Room", "Volunteer", "vegetarian", "Has the door code"),
    ("Tobias Lindqvist", "tobias@example.com", "Kitchen", "Guest", "no shellfish", ""),
    ("Sofia Marchetti", "sofia@example.com", "Design", "Guest", "vegan", ""),
    ("Kenji Watanabe", "kenji@example.com", "Engine Room", "Guest", "", "Bringing a plus one"),
    ("Amara Boateng", "amara@example.com", "Ops", "Organiser", "gluten free", "Arriving late"),
    ("Lucas Ferreira", "lucas@example.com", "Sound", "Performer", "", "Playing at 21:00"),
]


def main() -> int:
    check_in_all = "--all-in" in sys.argv
    store = ExcelStore(WORKBOOK)
    store.ensure()
    service = EventService(store, lambda: {}, lambda: [])

    created = 0
    for name, email, team, role, dietary, notes in DEMO_GUESTS:
        result = service.register(
            {
                "name": name,
                "email": email,
                "team": team,
                "role": role,
                "dietary": dietary,
                "notes": notes,
            }
        )
        ticket = result["attendee"]["ticket_id"]
        if not result["already_registered"]:
            created += 1

        should_check_in = check_in_all or created <= 4
        if should_check_in and result["attendee"]["status"] != "Checked in":
            service.check_in(ticket, "demo")

        status = "checked in" if should_check_in else "registered"
        print(f"  {ticket}  {name:<20} {status}")

    print(f"\n  {created} new guests added to {WORKBOOK}")
    print("  Start the server with ./run.sh, then open /scan.html or /draw.html\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
