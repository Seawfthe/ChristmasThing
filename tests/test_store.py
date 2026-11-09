"""Backend tests — run with:  .venv/bin/python -m unittest discover -s tests -v"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from openpyxl import load_workbook  # noqa: E402

from app.service import EventService, normalise_ticket  # noqa: E402
from app.store import STATUS_PRESENT, STATUS_REGISTERED, ExcelStore, StoreError  # noqa: E402

CONFIG = {
    "name": "Test Thing",
    "date": "2026-12-19",
    "time": "18:30",
    "prizes": ["Prize one", "Prize two"],
}


class EventTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "attendees.xlsx"
        self.store = ExcelStore(self.path)
        self.store.ensure()
        self.service = EventService(self.store, lambda: dict(CONFIG), lambda: [])

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # ------------------------------------------------------------------ setup
    def test_workbook_has_expected_sheets(self) -> None:
        wb = load_workbook(self.path)
        try:
            self.assertEqual(wb.sheetnames[:3], ["Attendees", "Winners", "Read me"])
            header = [cell.value for cell in wb["Attendees"][1]]
            self.assertIn("Ticket ID", header)
            self.assertIn("Name", header)
            self.assertIn("Status", header)
        finally:
            wb.close()

    # ----------------------------------------------------------- registration
    def test_register_appends_a_row(self) -> None:
        result = self.service.register({"name": "Mira Okonkwo", "email": "mira@example.com"})
        ticket = result["attendee"]["ticket_id"]

        self.assertRegex(ticket, r"^CT-[A-Z0-9]{4}-[A-Z0-9]{4}$")
        self.assertFalse(result["already_registered"])
        self.assertEqual(len(self.store.attendees()), 1)
        self.assertEqual(result["attendee"]["status"], STATUS_REGISTERED)
        self.assertEqual(result["ticket_url"], f"ticket.html?code={ticket}")

        # The row really is in the Excel file, not just in memory.
        wb = load_workbook(self.path)
        try:
            row = [cell.value for cell in wb["Attendees"][2]]
        finally:
            wb.close()
        self.assertIn(ticket, row)
        self.assertIn("Mira Okonkwo", row)

    def test_same_email_returns_existing_ticket(self) -> None:
        first = self.service.register({"name": "Mira", "email": "mira@example.com"})
        second = self.service.register({"name": "Miriam", "email": "MIRA@example.com"})
        self.assertTrue(second["already_registered"])
        self.assertEqual(first["attendee"]["ticket_id"], second["attendee"]["ticket_id"])
        self.assertEqual(len(self.store.attendees()), 1)

    def test_name_is_required(self) -> None:
        with self.assertRaises(StoreError):
            self.service.register({"name": " "})

    def test_bad_email_is_rejected(self) -> None:
        with self.assertRaises(StoreError):
            self.service.register({"name": "Mira", "email": "not-an-email"})

    # ---------------------------------------------------------------- check-in
    def test_check_in_updates_the_row(self) -> None:
        ticket = self.service.register({"name": "Mira"})["attendee"]["ticket_id"]

        result = self.service.check_in(ticket, "scan")
        self.assertFalse(result["already_checked_in"])
        self.assertEqual(result["attendee"]["status"], STATUS_PRESENT)
        self.assertTrue(result["attendee"]["checked_in_at"])
        self.assertEqual(result["attendee"]["checkin_source"], "scan")

        again = self.service.check_in(ticket, "scan")
        self.assertTrue(again["already_checked_in"])

        undone = self.service.undo_check_in(ticket)
        self.assertEqual(undone["attendee"]["status"], STATUS_REGISTERED)
        self.assertEqual(undone["attendee"]["checked_in_at"], "")

    def test_check_in_from_a_url_payload(self) -> None:
        ticket = self.service.register({"name": "Mira"})["attendee"]["ticket_id"]
        payload = f"http://192.168.1.20:8000/ticket.html?code={ticket}"
        result = self.service.check_in(payload)
        self.assertEqual(result["attendee"]["ticket_id"], ticket)

    def test_unknown_ticket(self) -> None:
        with self.assertRaises(StoreError):
            self.service.check_in("CT-XXXX-XXXX")

    # ------------------------------------------------------------------ draw
    def test_draw_only_picks_checked_in_guests(self) -> None:
        inside = self.service.register({"name": "Inside"})["attendee"]["ticket_id"]
        self.service.register({"name": "Outside"})
        self.service.check_in(inside)

        result = self.service.draw(prize="Headphones")
        self.assertEqual(result["winner"]["name"], "Inside")
        self.assertEqual(result["pool_size"], 1)
        self.assertEqual(len(self.store.winners()), 1)

    def test_draw_does_not_repeat_winners(self) -> None:
        tickets = [
            self.service.register({"name": f"Guest {index}"})["attendee"]["ticket_id"]
            for index in range(3)
        ]
        for ticket in tickets:
            self.service.check_in(ticket)

        first = self.service.draw(prize="One")
        second = self.service.draw(prize="Two")
        self.assertNotEqual(first["winner"]["ticket_id"], second["winner"]["ticket_id"])

        third = self.service.draw(prize="Three")
        self.assertEqual(len({first["winner"]["ticket_id"], second["winner"]["ticket_id"], third["winner"]["ticket_id"]}), 3)

        with self.assertRaises(StoreError):
            self.service.draw(prize="Four")  # everyone has won already

    def test_empty_pool_is_a_friendly_error(self) -> None:
        with self.assertRaises(StoreError) as raised:
            self.service.draw()
        self.assertEqual(raised.exception.code, "empty_pool")

    def test_reset_clears_winners_only(self) -> None:
        ticket = self.service.register({"name": "Mira"})["attendee"]["ticket_id"]
        self.service.check_in(ticket)
        self.service.draw(prize="One")
        self.service.reset_draw()
        self.assertEqual(self.store.winners(), [])
        self.assertEqual(len(self.store.attendees()), 1)

    # --------------------------------------------------------- dynamic workbook
    def test_external_excel_edit_is_picked_up(self) -> None:
        self.service.register({"name": "Typo Name"})

        wb = load_workbook(self.path)
        try:
            wb["Attendees"].cell(row=2, column=2, value="Fixed Name")
            wb.save(self.path)
        finally:
            wb.close()

        self.assertEqual(self.store.attendees()[0]["name"], "Fixed Name")

    def test_extra_column_survives_new_rows(self) -> None:
        self.service.register({"name": "First Guest"})

        wb = load_workbook(self.path)
        try:
            sheet = wb["Attendees"]
            sheet.cell(row=1, column=sheet.max_column + 1, value="Badge")
            sheet.cell(row=2, column=sheet.max_column, value="VIP")
            wb.save(self.path)
        finally:
            wb.close()

        self.service.register({"name": "Second Guest", "email": "second@example.com"})

        wb = load_workbook(self.path)
        try:
            sheet = wb["Attendees"]
            header = [cell.value for cell in sheet[1]]
            self.assertIn("Badge", header)
            badge_column = header.index("Badge") + 1
            self.assertEqual(sheet.cell(row=2, column=badge_column).value, "VIP")
            self.assertIn("Second Guest", [cell.value for cell in sheet[3]])
        finally:
            wb.close()


class TicketCodeTests(unittest.TestCase):
    def test_normalises_common_shapes(self) -> None:
        self.assertEqual(normalise_ticket("ct-abcd-efgh"), "CT-ABCD-EFGH")
        self.assertEqual(normalise_ticket("CT-ABCD-EFGH"), "CT-ABCD-EFGH")
        self.assertEqual(normalise_ticket("ABCDEFGH"), "CT-ABCD-EFGH")
        self.assertEqual(
            normalise_ticket("http://127.0.0.1:8000/ticket.html?code=CT-ABCD-EFGH"),
            "CT-ABCD-EFGH",
        )
        self.assertIsNone(normalise_ticket("hello there"))
        self.assertIsNone(normalise_ticket(""))


if __name__ == "__main__":
    unittest.main()
