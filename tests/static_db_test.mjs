/* Node smoke tests for the static build's browser database.
 *
 *   node tests/static_db_test.mjs
 *
 * Loads static/js/db.js in a VM with a fake localStorage and the real SheetJS
 * library, then exercises registration, check-in, draw, and Excel round-trips.
 */

import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("../static/js/vendor/xlsx.full.min.js");

function makeLocalStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  localStorage: makeLocalStorage(),
  crypto: globalThis.crypto,
  XLSX,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(new URL("../static/js/db.js", import.meta.url), "utf8"),
  sandbox,
  { filename: "db.js" }
);

const DB = sandbox.LocalDB;
assert.ok(DB, "LocalDB should be exposed");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

console.log("\n  Static database tests\n  " + "-".repeat(40));

test("starts empty", () => {
  assert.equal(DB.attendees().length, 0);
  assert.equal(DB.stats().registered, 0);
});

test("rejects bad input", () => {
  assert.throws(() => DB.register({ name: " " }), /name/i);
  assert.throws(() => DB.register({ name: "Mira", email: "nope" }), /email/i);
});

test("registers and mints a ticket code", () => {
  const result = DB.register({ name: "Mira Okonkwo", email: "mira@example.com", team: "Engine" });
  assert.match(result.attendee.ticket_id, /^CT-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(result.attendee.status, "Registered");
  assert.equal(result.already_registered, false);
  assert.equal(DB.stats().registered, 1);
});

test("deduplicates by email", () => {
  const again = DB.register({ name: "Mira Again", email: "MIRA@example.com" });
  assert.equal(again.already_registered, true);
  assert.equal(DB.stats().registered, 1);
});

test("checks in, reports duplicates, and undoes", () => {
  const code = DB.attendees()[0].ticket_id;
  const first = DB.checkIn(code, "scan");
  assert.equal(first.already_checked_in, false);
  assert.equal(first.attendee.status, "Checked in");
  assert.match(first.attendee.checked_in_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  const second = DB.checkIn(code, "scan");
  assert.equal(second.already_checked_in, true);

  const undone = DB.undoCheckIn(code);
  assert.equal(undone.attendee.status, "Registered");
  assert.throws(() => DB.checkIn("CT-XXXX-XXXX"), /No ticket/);
});

test("checks in from a scanned URL payload", () => {
  const code = DB.attendees()[0].ticket_id;
  const result = DB.checkIn(`https://example.com/christmas.html#/ticket?code=${code}`, "scan");
  assert.equal(result.attendee.ticket_id, code);
});

test("draw only picks checked-in guests and never repeats", () => {
  DB.register({ name: "Second Guest", email: "second@example.com" });
  const codes = DB.attendees().map((row) => row.ticket_id);
  codes.forEach((code) => DB.checkIn(code, "manual"));
  assert.equal(DB.stats().checked_in, 2);

  const one = DB.draw({ prize: "One" });
  const two = DB.draw({ prize: "Two" });
  assert.notEqual(one.winner.ticket_id, two.winner.ticket_id);
  assert.equal(DB.stats().prizes_awarded, 2);
  assert.throws(() => DB.draw({ prize: "Three" }), /Nobody is eligible/);

  DB.resetDraw();
  assert.equal(DB.winners().length, 0);
});

test("imports rows with a header, skipping duplicates", () => {
  const rows = [
    ["Name", "Email", "Team"],
    ["Priya Raman", "priya@example.com", "Lighting"],
    ["Mira Okonkwo", "mira@example.com", "Engine"],
    ["", "", ""],
  ];
  const result = DB.importRows(rows);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.invalid, 0);
  assert.ok(DB.findByEmail("priya@example.com"));
});

test("imports rows without a header (column A = names)", () => {
  const result = DB.importRows([["Yuki Tanaka"], ["Oskar Nowak"]]);
  assert.equal(result.added, 2);
  assert.ok(DB.attendees().some((row) => row.name === "Yuki Tanaka"));
});

test("builds a real workbook that round-trips through SheetJS", () => {
  const wb = DB.buildWorkbook();
  assert.equal(wb.SheetNames.join("|"), "Attendees|Winners|Read me");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  const reopened = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(reopened.Sheets["Attendees"], { header: 1 });

  assert.equal(rows[0][0], "Ticket ID");
  assert.equal(rows.length, DB.attendees().length + 1);
  assert.ok(rows.some((row) => row[1] === "Mira Okonkwo"));
});

test("clears everything", () => {
  DB.clearAll();
  assert.equal(DB.stats().registered, 0);
  assert.equal(DB.stats().checked_in, 0);
});

console.log(`  ${"-".repeat(40)}`);
console.log(`  ${passed} tests passed\n`);
