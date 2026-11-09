#!/usr/bin/env python3
"""Bring an existing guest list into the database.

    python scripts/import_names.py guests.xlsx
    python scripts/import_names.py guests.csv
    python scripts/import_names.py guests.xlsx --dry-run

Reads the first sheet of an .xlsx (or a .csv), looks for a header row with
columns like Name / Email / Team, and registers everyone. People already on the
list (matching email) are skipped, so running it twice is harmless.

If there is no recognisable header, column A is treated as names.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.service import EventService  # noqa: E402
from app.store import ExcelStore  # noqa: E402

DATA = ROOT / "data"
WORKBOOK = DATA / "attendees.xlsx"

ALIASES = {
    "name": ("name", "full name", "guest", "attendee", "person"),
    "email": ("email", "e-mail", "mail"),
    "phone": ("phone", "mobile", "telephone", "contact number"),
    "team": ("team", "org", "organisation", "organization", "department", "company"),
    "role": ("role", "ticket type"),
    "dietary": ("dietary", "diet", "allergy", "allergies", "food"),
    "notes": ("notes", "note", "comment", "comments", "remarks"),
}


def normalise(value: object) -> str:
    return str(value or "").strip().casefold()


def map_columns(header: list[object]) -> dict[str, int] | None:
    """Return {field: column index} for a header row, or None if no Name."""
    cells = [normalise(cell) for cell in header]
    mapping: dict[str, int] = {}

    # Exact alias matches win, so "Surname" never gets confused with "Name".
    for field, aliases in ALIASES.items():
        for index, cell in enumerate(cells):
            if cell in aliases:
                mapping[field] = index
                break
    # Then a looser pass for headers like "Guest name (please print)".
    for field, aliases in ALIASES.items():
        if field in mapping:
            continue
        for index, cell in enumerate(cells):
            if any(alias in cell for alias in aliases):
                mapping[field] = index
                break

    return mapping if "name" in mapping else None


def read_rows(path: Path) -> list[list[object]]:
    suffix = path.suffix.casefold()
    if suffix in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            sheet = wb.worksheets[0]
            return [list(row) for row in sheet.iter_rows(values_only=True)]
        finally:
            wb.close()
    if suffix in (".csv", ".txt"):
        with path.open(newline="", encoding="utf-8-sig") as handle:
            return [list(row) for row in csv.reader(handle)]
    raise SystemExit(f"Unsupported file type: {path.suffix} (use .xlsx or .csv)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import names into the Christmas Thing database.")
    parser.add_argument("file", type=Path, help="path to an .xlsx or .csv guest list")
    parser.add_argument("--dry-run", action="store_true", help="preview without writing to the workbook")
    args = parser.parse_args()

    source = args.file.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"File not found: {source}")
    if source == WORKBOOK.resolve():
        raise SystemExit("That's the live database — point this at the list you want to import instead.")

    rows = read_rows(source)
    rows = [row for row in rows if any(normalise(cell) for cell in row)]
    if not rows:
        raise SystemExit("That file looks empty.")

    mapping = map_columns(rows[0])
    if mapping is None:
        print("  No header row found — treating column A as names.")
        data_rows = rows
        mapping = {"name": 0}
    else:
        data_rows = rows[1:]

    store = ExcelStore(WORKBOOK)
    store.ensure()
    service = EventService(store, lambda: {}, lambda: [])

    def cell(row: list[object], field: str) -> str:
        index = mapping.get(field)
        if index is None or index >= len(row):
            return ""
        return str(row[index] or "").strip()

    created = skipped = invalid = 0
    for row in data_rows:
        name = cell(row, "name")
        email = cell(row, "email")
        payload = {
            "name": name,
            "email": email,
            "phone": cell(row, "phone"),
            "team": cell(row, "team"),
            "role": cell(row, "role") if cell(row, "role") in {"Guest", "Organiser", "Volunteer", "Performer", "Plus one"} else "Guest",
            "dietary": cell(row, "dietary"),
            "notes": cell(row, "notes"),
        }

        if args.dry_run:
            print(f"  would add  {name:<24} {email}")
            created += 1
            continue

        try:
            result = service.register(payload)
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"  skipped  {name or '(blank)':<24} {exc}")
            invalid += 1
            continue

        if result["already_registered"]:
            skipped += 1
        else:
            created += 1
            print(f"  added    {result['attendee']['ticket_id']}  {result['attendee']['name']}")

    print(f"\n  {created} added · {skipped} already on the list · {invalid} skipped")
    if args.dry_run:
        print("  (dry run — nothing was written)")
    else:
        print(f"  Database: {WORKBOOK}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
