/* ==========================================================================
   LocalDB — the "Excel database", entirely in the browser.

   Mirrors the workbook schema: Attendees + Winners. State lives in
   localStorage; real .xlsx files can be imported and exported on demand.
   Everything is synchronous except file reading, so the UI stays snappy.
   ========================================================================== */

(function (root) {
  "use strict";

  const STORAGE_KEY = "christmas-thing.db.v1";
  const STATUS = { registered: "Registered", present: "Checked in" };
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const TICKET_RE = /CT-[A-Z0-9]{4}-[A-Z0-9]{4}/i;
  const LOOSE_RE = /\b[A-Z0-9]{8}\b/i;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const ATTENDEE_COLUMNS = [
    ["ticket_id", "Ticket ID", 16],
    ["name", "Name", 24],
    ["email", "Email", 30],
    ["phone", "Phone", 16],
    ["team", "Team / Org", 24],
    ["role", "Role", 14],
    ["dietary", "Dietary", 20],
    ["notes", "Notes", 34],
    ["registered_at", "Registered At", 20],
    ["status", "Status", 14],
    ["checked_in_at", "Checked In At", 20],
    ["checkin_source", "Check-in Source", 18],
  ];

  const WINNER_COLUMNS = [
    ["draw_no", "Draw #", 8],
    ["ticket_id", "Ticket ID", 16],
    ["name", "Name", 24],
    ["prize", "Prize", 34],
    ["drawn_at", "Drawn At", 20],
  ];

  const READ_ME = [
    "Christmas Thing — attendee database",
    "",
    "Exported from the static site. The browser is the database; this workbook",
    "is a portable copy you can open, edit, print, or archive.",
    "",
    "Tabs:",
    "  Attendees — everyone registered, with check-in state",
    "  Winners   — the lucky draw log",
    "",
    "To move the event to another laptop, import this file on the new machine",
    "from Admin → Import Excel.",
  ];

  const DEMO_GUESTS = [
    ["Mira Okonkwo", "mira@example.com", "Engine Room", "Volunteer", "vegetarian", "Has the door code"],
    ["Tobias Lindqvist", "tobias@example.com", "Kitchen", "Guest", "no shellfish", ""],
    ["Sofia Marchetti", "sofia@example.com", "Design", "Guest", "vegan", ""],
    ["Kenji Watanabe", "kenji@example.com", "Engine Room", "Guest", "", "Bringing a plus one"],
    ["Amara Boateng", "amara@example.com", "Ops", "Organiser", "gluten free", "Arriving late"],
    ["Lucas Ferreira", "lucas@example.com", "Sound", "Performer", "", "Playing at 21:00"],
  ];

  /* ------------------------------------------------------------------ state */
  let memoryFallback = null;

  function storage() {
    try {
      if (root.localStorage) {
        const probe = "__christmas_probe__";
        root.localStorage.setItem(probe, "1");
        root.localStorage.removeItem(probe);
        return root.localStorage;
      }
    } catch (_) {
      /* file:// in some browsers, private mode, quota — fall through */
    }
    if (!memoryFallback) {
      memoryFallback = {
        data: {},
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
        },
        setItem(key, value) {
          this.data[key] = String(value);
        },
        removeItem(key) {
          delete this.data[key];
        },
      };
    }
    return memoryFallback;
  }

  function blank() {
    return { version: 1, attendees: [], winners: [] };
  }

  function read() {
    try {
      const raw = storage().getItem(STORAGE_KEY);
      if (!raw) return blank();
      const parsed = JSON.parse(raw);
      return {
        version: 1,
        attendees: Array.isArray(parsed.attendees) ? parsed.attendees : [],
        winners: Array.isArray(parsed.winners) ? parsed.winners : [],
      };
    } catch (_) {
      return blank();
    }
  }

  function write(state) {
    try {
      storage().setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      throw new Error("Could not save — this browser's storage is full or blocked.");
    }
  }

  /* ------------------------------------------------------------------ utils */
  function stamp(date) {
    const value = date || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}`
    );
  }

  function text(value, limit) {
    const clean = String(value == null ? "" : value).trim();
    return limit ? clean.slice(0, limit) : clean;
  }

  function randomInt(max) {
    if (root.crypto && root.crypto.getRandomValues) {
      const buffer = new Uint32Array(1);
      const limit = Math.floor(0xffffffff / max) * max;
      let value;
      do {
        root.crypto.getRandomValues(buffer);
        value = buffer[0];
      } while (value >= limit);
      return value % max;
    }
    return Math.floor(Math.random() * max);
  }

  function pick(list) {
    return list[randomInt(list.length)];
  }

  function parseTicket(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    const strict = raw.match(TICKET_RE);
    if (strict) return strict[0].toUpperCase();
    const loose = raw.match(LOOSE_RE);
    if (loose) {
      const code = loose[0].toUpperCase();
      return `CT-${code.slice(0, 4)}-${code.slice(4)}`;
    }
    return null;
  }

  function newTicketCode(taken) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let raw = "";
      for (let i = 0; i < 8; i += 1) raw += pick(ALPHABET.split(""));
      const code = `CT-${raw.slice(0, 4)}-${raw.slice(4)}`;
      if (!taken.has(code)) return code;
    }
    throw new Error("Couldn't generate a unique ticket code.");
  }

  function validateEmail(email) {
    return !email || EMAIL_RE.test(email);
  }

  /* ----------------------------------------------------------------- lookup */
  function attendees() {
    return read().attendees.map((row) => Object.assign({}, row));
  }

  function winners() {
    return read().winners.map((row) => Object.assign({}, row));
  }

  function findAttendee(code) {
    const wanted = String(code || "").trim().toUpperCase();
    if (!wanted) return null;
    return attendees().find((row) => String(row.ticket_id || "").toUpperCase() === wanted) || null;
  }

  function findByEmail(email) {
    const wanted = String(email || "").trim().toLowerCase();
    if (!wanted) return null;
    return attendees().find((row) => String(row.email || "").trim().toLowerCase() === wanted) || null;
  }

  function stats() {
    const state = read();
    const present = state.attendees.filter((row) => row.status === STATUS.present);
    return {
      registered: state.attendees.length,
      checked_in: present.length,
      pending: state.attendees.length - present.length,
      prizes_awarded: state.winners.length,
      check_in_rate: state.attendees.length
        ? Math.round((present.length / state.attendees.length) * 100)
        : 0,
      last_check_in: present.length ? present[present.length - 1].name : "",
    };
  }

  function recent(limit) {
    return attendees()
      .filter((row) => row.status === STATUS.present)
      .sort((a, b) => String(a.checked_in_at).localeCompare(String(b.checked_in_at)))
      .slice(-(limit || 5))
      .reverse()
      .map((row) => ({
        ticket_id: row.ticket_id,
        name: row.name,
        checked_in_at: row.checked_in_at,
      }));
  }

  /* ----------------------------------------------------------- registration */
  function register(payload) {
    const name = text(payload && payload.name, 80);
    const email = text(payload && payload.email, 120);
    const phone = text(payload && payload.phone, 40);
    const team = text(payload && payload.team, 80);
    const role = text(payload && payload.role, 40) || "Guest";
    const dietary = text(payload && payload.dietary, 120);
    const notes = text(payload && payload.notes, 500);

    if (name.length < 2) throw new Error("Please give us a name — at least two characters.");
    if (!validateEmail(email)) throw new Error("That email doesn't look quite right.");

    const state = read();
    if (email) {
      const existing = state.attendees.find(
        (row) => String(row.email || "").trim().toLowerCase() === email.toLowerCase()
      );
      if (existing) {
        return {
          attendee: Object.assign({}, existing),
          already_registered: true,
          ticket_url: `#/ticket?code=${existing.ticket_id}`,
        };
      }
    }

    const taken = new Set(state.attendees.map((row) => row.ticket_id));
    const record = {
      ticket_id: newTicketCode(taken),
      name,
      email,
      phone,
      team,
      role,
      dietary,
      notes,
      registered_at: stamp(),
      status: STATUS.registered,
      checked_in_at: "",
      checkin_source: "",
    };
    state.attendees.push(record);
    write(state);
    return {
      attendee: Object.assign({}, record),
      already_registered: false,
      ticket_url: `#/ticket?code=${record.ticket_id}`,
    };
  }

  /* ---------------------------------------------------------------- check-in */
  function updateAttendee(code, updates) {
    const wanted = String(code || "").trim().toUpperCase();
    const state = read();
    const row = state.attendees.find(
      (item) => String(item.ticket_id || "").toUpperCase() === wanted
    );
    if (!row) throw new Error(`No ticket found for ${wanted || "that code"}.`);
    Object.assign(row, updates);
    write(state);
    return Object.assign({}, row);
  }

  function checkIn(rawCode, source) {
    const code = parseTicket(rawCode);
    if (!code) throw new Error("That doesn't look like a ticket code.");
    const record = findAttendee(code);
    if (!record) throw new Error(`No ticket found for ${code}.`);
    if (record.status === STATUS.present) {
      return {
        attendee: record,
        already_checked_in: true,
        checked_in_at: record.checked_in_at,
      };
    }
    const attendee = updateAttendee(code, {
      status: STATUS.present,
      checked_in_at: stamp(),
      checkin_source: text(source, 20) || "scan",
    });
    return { attendee, already_checked_in: false, stats: stats() };
  }

  function undoCheckIn(rawCode) {
    const code = parseTicket(rawCode);
    if (!code) throw new Error("That doesn't look like a ticket code.");
    if (!findAttendee(code)) throw new Error(`No ticket found for ${code}.`);
    const attendee = updateAttendee(code, {
      status: STATUS.registered,
      checked_in_at: "",
      checkin_source: "",
    });
    return { attendee, stats: stats() };
  }

  /* -------------------------------------------------------------- lucky draw */
  function draw(options) {
    const opts = options || {};
    const prize = text(opts.prize, 120) || "Mystery prize";
    const eligible = opts.eligible === "registered" ? "registered" : "checked_in";
    const allowRepeat = Boolean(opts.allow_repeat);

    const state = read();
    let pool =
      eligible === "registered"
        ? state.attendees.slice()
        : state.attendees.filter((row) => row.status === STATUS.present);

    if (!allowRepeat) {
      const previous = new Set(state.winners.map((winner) => winner.ticket_id));
      pool = pool.filter((row) => !previous.has(row.ticket_id));
    }
    if (!pool.length) {
      throw new Error("Nobody is eligible for this draw yet. Check guests in first.");
    }

    const winner = pick(pool);
    const record = {
      draw_no: String(state.winners.length + 1),
      ticket_id: winner.ticket_id,
      name: winner.name,
      prize,
      drawn_at: stamp(),
    };
    state.winners.push(record);
    write(state);

    const names = pool.map((row) => row.name);
    const candidates = names.slice();
    if (candidates.length > 48) {
      candidates.length = 0;
      while (candidates.length < 48 && names.length) {
        const index = randomInt(names.length);
        candidates.push(names.splice(index, 1)[0]);
      }
    }
    if (!candidates.includes(winner.name)) candidates.push(winner.name);

    return {
      winner: { ticket_id: winner.ticket_id, name: winner.name, prize },
      record,
      prize,
      pool_size: pool.length,
      pool_label: eligible === "checked_in" ? "checked-in guests" : "registered guests",
      candidates,
      stats: stats(),
      history: winners().slice(-10),
    };
  }

  function resetDraw() {
    const state = read();
    state.winners = [];
    write(state);
    return { ok: true, stats: stats() };
  }

  /* ------------------------------------------------------------------- demo */
  function seedDemo() {
    const state = read();
    let created = 0;
    DEMO_GUESTS.forEach((guest, index) => {
      const [name, email, team, role, dietary, notes] = guest;
      const exists = state.attendees.some(
        (row) => String(row.email || "").toLowerCase() === email.toLowerCase()
      );
      if (exists) return;
      const taken = new Set(state.attendees.map((row) => row.ticket_id));
      const checkInAt = index < 4;
      state.attendees.push({
        ticket_id: newTicketCode(taken),
        name,
        email,
        phone: "",
        team,
        role,
        dietary,
        notes,
        registered_at: stamp(new Date(Date.now() - (6 - index) * 60000)),
        status: checkInAt ? STATUS.present : STATUS.registered,
        checked_in_at: checkInAt ? stamp(new Date(Date.now() - (6 - index) * 30000)) : "",
        checkin_source: checkInAt ? "demo" : "",
      });
      created += 1;
    });
    write(state);
    return { created, stats: stats() };
  }

  function clearAll() {
    storage().removeItem(STORAGE_KEY);
    return { ok: true, stats: stats() };
  }

  /* ------------------------------------------------------------------ Excel */
  const ALIASES = {
    name: ["name", "full name", "guest", "attendee", "person"],
    email: ["email", "e-mail", "mail"],
    phone: ["phone", "mobile", "telephone", "contact number"],
    team: ["team", "org", "organisation", "organization", "department", "company"],
    role: ["role", "ticket type"],
    dietary: ["dietary", "diet", "allergy", "allergies", "food"],
    notes: ["notes", "note", "comment", "comments", "remarks"],
    ticket_id: ["ticket id", "ticket", "code", "ticket code"],
    status: ["status"],
    checked_in_at: ["checked in at", "check in time", "checked in"],
    registered_at: ["registered at", "registered", "signup time"],
  };

  function normaliseHeader(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function mapColumns(header) {
    const cells = header.map(normaliseHeader);
    const mapping = {};
    Object.keys(ALIASES).forEach((field) => {
      const aliases = ALIASES[field];
      const exact = cells.findIndex((cell) => aliases.includes(cell));
      if (exact !== -1) {
        mapping[field] = exact;
        return;
      }
      const loose = cells.findIndex((cell) => aliases.some((alias) => cell.includes(alias)));
      if (loose !== -1) mapping[field] = loose;
    });
    return mapping.name === undefined ? null : mapping;
  }

  function importRows(rows) {
    const clean = rows.filter((row) => row.some((cell) => String(cell == null ? "" : cell).trim()));
    if (!clean.length) throw new Error("That file looks empty.");

    let mapping = mapColumns(clean[0]);
    let dataRows = clean;
    if (mapping) {
      dataRows = clean.slice(1);
    } else {
      mapping = { name: 0 };
      if (normaliseHeader(clean[0][0]) === "name" || normaliseHeader(clean[0][0]) === "full name") {
        dataRows = clean.slice(1);
      }
    }

    const cell = (row, field) => {
      const index = mapping[field];
      if (index === undefined || index >= row.length) return "";
      return text(row[index]);
    };

    let added = 0;
    let skipped = 0;
    let invalid = 0;
    dataRows.forEach((row) => {
      const name = cell(row, "name");
      if (name.length < 2) {
        invalid += 1;
        return;
      }
      try {
        const result = register({
          name,
          email: cell(row, "email"),
          phone: cell(row, "phone"),
          team: cell(row, "team"),
          role: cell(row, "role"),
          dietary: cell(row, "dietary"),
          notes: cell(row, "notes"),
        });
        if (result.already_registered) {
          skipped += 1;
        } else {
          added += 1;
        }
      } catch (_) {
        invalid += 1;
      }
    });

    return { added, skipped, invalid, total: dataRows.length };
  }

  function requireXLSX() {
    if (typeof XLSX === "undefined") {
      throw new Error("The Excel library hasn't loaded. Reload the page and try again.");
    }
    return XLSX;
  }

  function buildWorkbook() {
    const xlsx = requireXLSX();
    const state = read();
    const wb = xlsx.utils.book_new();

    const attendeeHeader = ATTENDEE_COLUMNS.map((column) => column[1]);
    const attendeeRows = [attendeeHeader].concat(
      state.attendees.map((row) => ATTENDEE_COLUMNS.map((column) => row[column[0]] || ""))
    );
    const attendeeSheet = xlsx.utils.aoa_to_sheet(attendeeRows);
    attendeeSheet["!cols"] = ATTENDEE_COLUMNS.map((column) => ({ wch: column[2] }));
    xlsx.utils.book_append_sheet(wb, attendeeSheet, "Attendees");

    const winnerHeader = WINNER_COLUMNS.map((column) => column[1]);
    const winnerRows = [winnerHeader].concat(
      state.winners.map((row) => WINNER_COLUMNS.map((column) => row[column[0]] || ""))
    );
    const winnerSheet = xlsx.utils.aoa_to_sheet(winnerRows);
    winnerSheet["!cols"] = WINNER_COLUMNS.map((column) => ({ wch: column[2] }));
    xlsx.utils.book_append_sheet(wb, winnerSheet, "Winners");

    const readmeSheet = xlsx.utils.aoa_to_sheet(READ_ME.map((line) => [line]));
    readmeSheet["!cols"] = [{ wch: 78 }];
    xlsx.utils.book_append_sheet(wb, readmeSheet, "Read me");

    return wb;
  }

  function exportWorkbook(filename) {
    const xlsx = requireXLSX();
    const wb = buildWorkbook();
    xlsx.writeFile(wb, filename || "attendees.xlsx", { compression: true });
    return { ok: true, filename: filename || "attendees.xlsx" };
  }

  function importWorkbook(file) {
    const xlsx = requireXLSX();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.onload = (event) => {
        try {
          const workbook = xlsx.read(new Uint8Array(event.target.result), { type: "array" });
          const sheetName = workbook.SheetNames.find((name) => /attend/i.test(name)) || workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
          resolve(importRows(rows));
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function exportCsv() {
    const rows = [
      ATTENDEE_COLUMNS.map((column) => column[1]),
      ...read().attendees.map((row) => ATTENDEE_COLUMNS.map((column) => row[column[0]] || "")),
    ];
    const escape = (value) => {
      const cell = String(value == null ? "" : value);
      return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
    };
    return rows.map((row) => row.map(escape).join(",")).join("\n");
  }

  /* ---------------------------------------------------------------- exports */
  const LocalDB = {
    STORAGE_KEY,
    ATTENDEE_COLUMNS,
    WINNER_COLUMNS,
    STATUS,
    storageAvailable: function () {
      return storage() !== memoryFallback;
    },
    attendees,
    winners,
    findAttendee,
    findByEmail,
    stats,
    recent,
    register,
    checkIn,
    undoCheckIn,
    updateAttendee,
    draw,
    resetDraw,
    seedDemo,
    clearAll,
    importRows,
    importWorkbook,
    buildWorkbook,
    exportWorkbook,
    exportCsv,
    parseTicket,
    validateEmail,
    stamp,
  };

  root.LocalDB = LocalDB;
  if (typeof module !== "undefined" && module.exports) module.exports = LocalDB;
})(typeof globalThis !== "undefined" ? globalThis : this);
