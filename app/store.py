"""Excel-backed storage.

The workbook is the single source of truth. The app appends rows to it when
people register, flips cells when they check in, and appends winners. Because
the file is also a real Excel file, an organiser can open it, hand-edit a name,
add a column, and the app picks it up on the next read — no restart, no import
step.

Mutations always reload the workbook from disk before saving, so an edit made
in Excel is never clobbered by a stale in-memory copy.
"""

from __future__ import annotations

import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

try:  # openpyxl is the single third-party dependency.
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError as exc:  # pragma: no cover - friendly failure path
    Workbook = load_workbook = None  # type: ignore[assignment]
    _IMPORT_ERROR: ImportError | None = exc
else:
    _IMPORT_ERROR = None

ATTENDEE_SHEET = "Attendees"
WINNER_SHEET = "Winners"

# (record key, Excel header, column width). Order defines new-workbook layout.
ATTENDEE_COLUMNS: list[tuple[str, str, int]] = [
    ("ticket_id", "Ticket ID", 16),
    ("name", "Name", 24),
    ("email", "Email", 30),
    ("phone", "Phone", 16),
    ("team", "Team / Org", 24),
    ("role", "Role", 14),
    ("dietary", "Dietary", 20),
    ("notes", "Notes", 34),
    ("registered_at", "Registered At", 20),
    ("status", "Status", 14),
    ("checked_in_at", "Checked In At", 20),
    ("checkin_source", "Check-in Source", 18),
]

WINNER_COLUMNS: list[tuple[str, str, int]] = [
    ("draw_no", "Draw #", 8),
    ("ticket_id", "Ticket ID", 16),
    ("name", "Name", 24),
    ("prize", "Prize", 34),
    ("drawn_at", "Drawn At", 20),
]

KEEPALIVE_SHEET = "Read me"
READ_ME = [
    "Christmas Thing — attendee database",
    "",
    "This workbook IS the database. The app reads and writes it live.",
    "",
    "• New registrations are appended to the Attendees sheet automatically.",
    "• Scanning a ticket flips Status to 'Checked in' and fills the timestamp.",
    "• Lucky draw winners are appended to the Winners sheet.",
    "• You may edit names, fix typos, or add extra columns while the app is idle.",
    "• Keep this file closed while guests are checking in (Excel locks it).",
    "• Reopen /admin.html in the app to see changes — it re-reads the file.",
]

STATUS_REGISTERED = "Registered"
STATUS_PRESENT = "Checked in"


class StoreError(Exception):
    """Domain error with a stable code the API turns into a JSON response."""

    def __init__(self, message: str, code: str = "store_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _cell(value: Any) -> str:
    """Normalise an Excel cell into a trimmed string."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _norm_header(value: Any) -> str:
    return _cell(value).casefold()


class ExcelStore:
    """Thread-safe wrapper around one workbook."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._attendees: list[dict[str, str]] | None = None
        self._attendees_mtime: int | None = None
        self._winners: list[dict[str, str]] | None = None
        self._winners_mtime: int | None = None

    # ------------------------------------------------------------------ setup
    @staticmethod
    def _require_openpyxl() -> None:
        if _IMPORT_ERROR is not None:
            raise StoreError(
                "openpyxl is not installed. Run: pip install -r requirements.txt",
                "missing_dependency",
            )

    def ensure(self) -> None:
        """Create the workbook (with headers) if it does not exist yet."""
        with self._lock:
            self._require_openpyxl()
            if self.path.exists():
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            wb = Workbook()
            ws = wb.active
            ws.title = ATTENDEE_SHEET
            self._write_header(ws, ATTENDEE_COLUMNS)

            winners = wb.create_sheet(WINNER_SHEET)
            self._write_header(winners, WINNER_COLUMNS)

            notes = wb.create_sheet(KEEPALIVE_SHEET)
            notes.column_dimensions["A"].width = 90
            for row, line in enumerate(READ_ME, start=1):
                notes.cell(row=row, column=1, value=line)
            notes["A1"].font = Font(bold=True, size=14)

            wb.save(self.path)
            self._invalidate()

    @staticmethod
    def _write_header(ws, columns: Iterable[tuple[str, str, int]]) -> None:
        fill = PatternFill("solid", fgColor="1E4D3A")
        font = Font(bold=True, color="FFFFFF")
        for idx, (_key, label, width) in enumerate(columns, start=1):
            cell = ws.cell(row=1, column=idx, value=label)
            cell.fill = fill
            cell.font = font
            cell.alignment = Alignment(vertical="center")
            ws.column_dimensions[get_column_letter(idx)].width = width
        ws.freeze_panes = "A2"

    def _invalidate(self) -> None:
        self._attendees = None
        self._attendees_mtime = None
        self._winners = None
        self._winners_mtime = None

    def _open(self):
        self._require_openpyxl()
        self.ensure()
        try:
            return load_workbook(self.path)
        except PermissionError as exc:
            raise StoreError(
                "The Excel file is locked. Close attendees.xlsx and try again.",
                "file_locked",
            ) from exc
        except OSError as exc:
            raise StoreError(f"Could not open the workbook: {exc}", "file_error") from exc

    def _save(self, wb) -> None:
        try:
            wb.save(self.path)
        except PermissionError as exc:
            raise StoreError(
                "Could not write the workbook — it is open in Excel. Close it and retry.",
                "file_locked",
            ) from exc
        finally:
            self._invalidate()

    @staticmethod
    def _sheet(wb, title: str):
        if title in wb.sheetnames:
            return wb[title]
        return wb.create_sheet(title)

    def _header_map(self, ws, columns: list[tuple[str, str, int]]) -> list[tuple[int, str]]:
        """Map actual sheet columns to record keys by header label (or key)."""
        by_label = {_norm_header(label): key for key, label, _w in columns}
        by_key = {key.casefold(): key for key, _label, _w in columns}
        mapping: list[tuple[int, str]] = []
        for col in range(1, max(ws.max_column, 1) + 1):
            norm = _norm_header(ws.cell(row=1, column=col).value)
            if not norm:
                continue
            key = by_label.get(norm) or by_key.get(norm) or norm
            mapping.append((col, key))
        if not mapping:  # empty/unstructured sheet: fall back to canonical order
            mapping = [(i, key) for i, (key, _l, _w) in enumerate(columns, start=1)]
        return mapping

    def _read_sheet(self, title: str, columns: list[tuple[str, str, int]]) -> list[dict[str, str]]:
        self.ensure()
        wb = load_workbook(self.path, read_only=True, data_only=True)
        try:
            ws = wb[title] if title in wb.sheetnames else None
            if ws is None:
                return []
            mapping = self._header_map(ws, columns)
            out: list[dict[str, str]] = []
            for row in ws.iter_rows(min_row=2, values_only=True):
                record = {
                    key: _cell(row[col - 1]) if col - 1 < len(row) else ""
                    for col, key in mapping
                }
                if any(record.values()):
                    out.append(record)
            return out
        finally:
            wb.close()

    # ---------------------------------------------------------------- attendees
    def attendees(self) -> list[dict[str, str]]:
        with self._lock:
            self.ensure()
            mtime = self.path.stat().st_mtime_ns
            if self._attendees is None or self._attendees_mtime != mtime:
                self._attendees = self._read_sheet(ATTENDEE_SHEET, ATTENDEE_COLUMNS)
                self._attendees_mtime = mtime
            return [dict(row) for row in self._attendees]

    def find_attendee(self, ticket_id: str) -> dict[str, str] | None:
        wanted = ticket_id.strip().upper()
        if not wanted:
            return None
        for row in self.attendees():
            if row.get("ticket_id", "").strip().upper() == wanted:
                return row
        return None

    def find_attendee_by_email(self, email: str) -> dict[str, str] | None:
        wanted = email.strip().casefold()
        if not wanted:
            return None
        for row in self.attendees():
            if row.get("email", "").strip().casefold() == wanted:
                return row
        return None

    def add_attendee(self, record: dict[str, str]) -> dict[str, str]:
        with self._lock:
            wb = self._open()
            ws = self._sheet(wb, ATTENDEE_SHEET)
            mapping = self._header_map(ws, ATTENDEE_COLUMNS)
            row_index = ws.max_row + 1
            for col, key in mapping:
                ws.cell(row=row_index, column=col, value=record.get(key, ""))
            self._save(wb)
            return self.find_attendee(record["ticket_id"]) or dict(record)

    def update_attendee(self, ticket_id: str, updates: dict[str, str]) -> dict[str, str]:
        with self._lock:
            wb = self._open()
            ws = self._sheet(wb, ATTENDEE_SHEET)
            mapping = self._header_map(ws, ATTENDEE_COLUMNS)
            ticket_col = next((col for col, key in mapping if key == "ticket_id"), None)
            if ticket_col is None:
                raise StoreError("The Attendees sheet has no Ticket ID column.", "bad_workbook")
            wanted = ticket_id.strip().upper()
            for row_index in range(2, ws.max_row + 1):
                cell_value = _cell(ws.cell(row=row_index, column=ticket_col).value).upper()
                if cell_value != wanted:
                    continue
                for col, key in mapping:
                    if key in updates:
                        ws.cell(row=row_index, column=col, value=updates[key])
                self._save(wb)
                updated = self.find_attendee(wanted)
                if updated is None:
                    raise StoreError("Attendee vanished during update.", "not_found")
                return updated
            raise StoreError(f"No attendee with ticket {ticket_id}.", "not_found")

    # ------------------------------------------------------------------ winners
    def winners(self) -> list[dict[str, str]]:
        with self._lock:
            self.ensure()
            mtime = self.path.stat().st_mtime_ns
            if self._winners is None or self._winners_mtime != mtime:
                self._winners = self._read_sheet(WINNER_SHEET, WINNER_COLUMNS)
                self._winners_mtime = mtime
            return [dict(row) for row in self._winners]

    def add_winner(self, ticket_id: str, name: str, prize: str, drawn_at: str) -> dict[str, str]:
        with self._lock:
            wb = self._open()
            ws = self._sheet(wb, WINNER_SHEET)
            mapping = self._header_map(ws, WINNER_COLUMNS)
            is_new = ws.max_row < 2
            if is_new:
                self._write_header(ws, WINNER_COLUMNS)
            draw_no = len(self.winners()) + 1
            record = {
                "draw_no": str(draw_no),
                "ticket_id": ticket_id,
                "name": name,
                "prize": prize,
                "drawn_at": drawn_at,
            }
            row_index = ws.max_row + 1
            for col, key in mapping:
                ws.cell(row=row_index, column=col, value=record.get(key, ""))
            self._save(wb)
            return record

    def clear_winners(self) -> None:
        with self._lock:
            wb = self._open()
            ws = self._sheet(wb, WINNER_SHEET)
            if ws.max_row > 1:
                ws.delete_rows(2, ws.max_row - 1)
            self._save(wb)
