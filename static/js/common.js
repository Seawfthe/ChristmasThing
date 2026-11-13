/* ==========================================================================
   Shared helpers for the static build:
   - App.api()      local stand-in for the server's JSON API
   - App.route()    hash router over the single page
   - toasts, QR codes, snow, confetti, sounds, tiny DOM helpers
   ========================================================================== */

const App = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ------------------------------------------------------------ local "API" */
  const STATUSES = LocalDB.STATUS;

  function filterAttendees(query, status) {
    let rows = LocalDB.attendees();
    const needle = String(query || "").trim().toLowerCase();
    const wanted = String(status || "").trim().toLowerCase();
    if (needle) {
      rows = rows.filter((row) =>
        Object.values(row).join(" ").toLowerCase().includes(needle)
      );
    }
    if (wanted && !["all", "any"].includes(wanted)) {
      if (wanted === "present") rows = rows.filter((row) => row.status === STATUSES.present);
      else if (wanted === "pending") rows = rows.filter((row) => row.status !== STATUSES.present);
      else rows = rows.filter((row) => String(row.status).toLowerCase() === wanted);
    }
    rows.sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
    return rows;
  }

  function bootstrapPayload() {
    return {
      event: window.EVENT,
      guides: window.GUIDES,
      stats: LocalDB.stats(),
      recent: LocalDB.recent(5),
      statuses: { registered: STATUSES.registered, present: STATUSES.present },
    };
  }

  function dispatch(method, path, body) {
    const [rawPath, rawQuery] = path.split("?");
    const query = new URLSearchParams(rawQuery || "");
    const route = rawPath.replace(/\/+$/, "");

    if (method === "GET" && route === "/api/bootstrap") return bootstrapPayload();
    if (method === "GET" && route === "/api/stats") return { stats: LocalDB.stats() };
    if (method === "GET" && route === "/api/lookup") {
      const needle = (query.get("query") || "").trim();
      if (!needle) return { attendees: [] };
      const fields = ["ticket_id", "name", "team", "role", "status", "checked_in_at"];
      const rows = filterAttendees(needle, "").slice(0, 20).map((row) =>
        Object.fromEntries(fields.map((field) => [field, row[field] || ""]))
      );
      return { attendees: rows };
    }
    if (method === "GET" && route === "/api/attendees") {
      return {
        attendees: filterAttendees(query.get("query"), query.get("status")),
        stats: LocalDB.stats(),
      };
    }
    if (method === "GET" && route.startsWith("/api/ticket/")) {
      const code = decodeURIComponent(route.slice("/api/ticket/".length));
      const attendee = LocalDB.findAttendee(LocalDB.parseTicket(code) || code);
      if (!attendee) throw new Error("No ticket with that code.");
      return { attendee };
    }
    if (method === "GET" && route === "/api/draw/history") {
      return { winners: LocalDB.winners(), stats: LocalDB.stats() };
    }
    if (method === "GET" && route === "/api/export") {
      LocalDB.exportWorkbook();
      return { ok: true };
    }
    if (method === "POST" && route === "/api/register") return LocalDB.register(body || {});
    if (method === "POST" && route === "/api/checkin") {
      return LocalDB.checkIn((body || {}).code, (body || {}).source || "scan");
    }
    if (method === "POST" && route === "/api/checkin/undo") {
      return LocalDB.undoCheckIn((body || {}).code);
    }
    if (method === "POST" && route === "/api/draw") {
      return LocalDB.draw(body || {});
    }
    if (method === "POST" && route === "/api/draw/reset") return LocalDB.resetDraw();
    throw new Error("Unknown endpoint.");
  }

  function api(path, options = {}) {
    const { method = "GET", body } = options;
    try {
      return Promise.resolve(dispatch(method, path, body));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function bootstrap() {
    return Promise.resolve(bootstrapPayload());
  }

  function ticketLink(code) {
    const base = window.location.href.split("#")[0].split("?")[0];
    return window.location.protocol === "file:"
      ? code
      : `${base}#/ticket?code=${encodeURIComponent(code)}`;
  }

  /* ------------------------------------------------------------------- text */
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();
  }

  /* ------------------------------------------------------------------ dates */
  const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function longDate(value) {
    const date = parseDate(value);
    return date ? DATE_FMT.format(date) : value || "";
  }

  function monthName(value) {
    const date = parseDate(value);
    return date ? date.toLocaleString("en-GB", { month: "long" }).toUpperCase() : "";
  }

  function dayNumber(value) {
    const date = parseDate(value);
    return date ? String(date.getDate()) : "";
  }

  /* ------------------------------------------------------------------ toast */
  function toast(message, kind = "") {
    const stack =
      $("#toast-stack") ||
      (() => {
        const el = document.createElement("div");
        el.id = "toast-stack";
        el.className = "toast-stack";
        document.body.appendChild(el);
        return el;
      })();
    const node = document.createElement("div");
    node.className = `toast ${kind}`.trim();
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(() => {
      node.style.transition = "opacity .2s ease";
      node.style.opacity = "0";
      setTimeout(() => node.remove(), 220);
    }, 3200);
  }

  /* -------------------------------------------------------------------- qr */
  function qrSvg(text, options = {}) {
    if (typeof qrcode !== "function") return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({
      cellSize: options.cellSize || 6,
      margin: options.margin || 2,
      scalable: true,
      alt: { text: options.alt || "QR code" },
    });
  }

  function absoluteUrl(relative) {
    return new URL(relative, window.location.href).href;
  }

  /* ------------------------------------------------------------------ sound */
  let audioCtx = null;

  function beep(kind = "ok") {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const notes = kind === "ok" ? [660, 880] : kind === "warn" ? [420, 420] : [220, 180];
      notes.forEach((frequency, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.13, now + index * 0.1 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.1 + 0.18);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + index * 0.1);
        osc.stop(now + index * 0.1 + 0.2);
      });
    } catch (_) {
      /* sound is a bonus */
    }
  }

  /* -------------------------------------------------------------- decoration */
  function snow(count = 26) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = document.createElement("div");
    layer.className = "snow";
    layer.setAttribute("aria-hidden", "true");
    for (let i = 0; i < count; i += 1) {
      const flake = document.createElement("i");
      const size = 1.5 + Math.random() * 3.5;
      flake.style.left = `${Math.random() * 100}%`;
      flake.style.width = `${size}px`;
      flake.style.height = `${size}px`;
      flake.style.opacity = String(0.18 + Math.random() * 0.5);
      flake.style.animationDuration = `${11 + Math.random() * 16}s`;
      flake.style.animationDelay = `${-Math.random() * 26}s`;
      flake.style.setProperty("--drift", `${(Math.random() - 0.5) * 14}vw`);
      layer.appendChild(flake);
    }
    document.body.appendChild(layer);
  }

  function confetti() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = document.createElement("div");
    layer.className = "confetti";
    layer.setAttribute("aria-hidden", "true");
    const colors = ["#d9a441", "#f0cd8a", "#b23a36", "#83c3a5", "#f8f2e6"];
    for (let i = 0; i < 90; i += 1) {
      const piece = document.createElement("i");
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = `${2.2 + Math.random() * 2.2}s`;
      piece.style.animationDelay = `${Math.random() * 0.6}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.style.width = `${5 + Math.random() * 6}px`;
      piece.style.height = `${9 + Math.random() * 10}px`;
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 5200);
  }

  /* ----------------------------------------------------------------- chrome */
  function fillEventFields(event) {
    if (!event) return;
    const set = (selector, value) => {
      $$(selector).forEach((node) => {
        node.textContent = value;
      });
    };
    set("[data-event='name']", event.name || "");
    set("[data-event='tagline']", event.tagline || "");
    set("[data-event='venue']", event.venue || "");
    set("[data-event='time']", event.time || "");
    set("[data-event='date']", longDate(event.date));
    set("[data-event='date-month']", monthName(event.date));
    set("[data-event='date-day']", dayNumber(event.date));
    set("[data-event='year']", String(parseDate(event.date)?.getFullYear() || new Date().getFullYear()));
    set("[data-event='deadline']", longDate(event.rsvp_deadline));
    set("[data-event='weekday']", parseDate(event.date)?.toLocaleString("en-GB", { weekday: "long" }) || "");
    $$("[data-event='name']").forEach((node) => {
      if (node.tagName === "TITLE") node.textContent = event.name;
    });
  }

  function fillStats(stats) {
    if (!stats) return;
    const map = {
      registered: stats.registered,
      checked_in: stats.checked_in,
      pending: stats.pending,
      prizes: stats.prizes_awarded,
      rate: `${stats.check_in_rate}%`,
    };
    Object.entries(map).forEach(([key, value]) => {
      $$(`[data-stat='${key}']`).forEach((node) => {
        node.textContent = value ?? "0";
      });
    });
  }

  async function hydrate({ stats = true } = {}) {
    fillEventFields(window.EVENT);
    if (stats) fillStats(LocalDB.stats());
    return bootstrapPayload();
  }

  function statusPill(status) {
    const present = String(status || "").toLowerCase().includes("checked");
    return `<span class="pill ${present ? "pill-present" : "pill-registered"}">${escapeHtml(
      status || "Registered"
    )}</span>`;
  }

  function debounce(fn, wait = 220) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${escapeHtml(label || "Working…")}`;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.label || button.textContent;
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard", "ok");
    } catch (_) {
      toast("Couldn't copy — select it manually", "bad");
    }
  }

  /* ------------------------------------------------------------ hash router */
  const routes = {};
  const TITLES = {
    home: () => window.EVENT.name,
    register: () => `Register · ${window.EVENT.name}`,
    ticket: () => `My ticket · ${window.EVENT.name}`,
    scan: () => `Scan desk · ${window.EVENT.name}`,
    draw: () => `Lucky draw · ${window.EVENT.name}`,
    guides: () => `Event guides · ${window.EVENT.name}`,
    admin: () => `Admin · ${window.EVENT.name}`,
  };

  function route(name, hooks = {}) {
    routes[name] = hooks;
  }

  function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, "") || "home";
    const questionMark = raw.indexOf("?");
    const name = (questionMark === -1 ? raw : raw.slice(0, questionMark)).toLowerCase() || "home";
    const params = new URLSearchParams(questionMark === -1 ? "" : raw.slice(questionMark + 1));
    return { name, params };
  }

  let activeRoute = null;

  function render() {
    const { name, params } = parseHash();
    const target = document.getElementById(`view-${name}`) ? name : "home";
    const nextView = document.getElementById(`view-${target}`);

    if (activeRoute && routes[activeRoute] && routes[activeRoute].leave) {
      try {
        routes[activeRoute].leave();
      } catch (error) {
        console.warn("route leave failed", error);
      }
    }

    $$(".view").forEach((view) => view.classList.toggle("is-active", view === nextView));
    $$("[data-nav]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.nav === target);
    });

    activeRoute = target;
    document.title = (TITLES[target] && TITLES[target]()) || window.EVENT.name;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    if (routes[target] && routes[target].enter) {
      try {
        routes[target].enter(params);
      } catch (error) {
        console.warn("route enter failed", error);
      }
    }
  }

  function go(name, params) {
    const query = params instanceof URLSearchParams ? params.toString() : "";
    window.location.hash = `#/${name}${query ? `?${query}` : ""}`;
  }

  function currentParams() {
    return parseHash().params;
  }

  function currentName() {
    return parseHash().name;
  }

  /* ------------------------------------------------------------------- boot */
  document.addEventListener("DOMContentLoaded", () => {
    snow();
    hydrate();
    render();
    window.addEventListener("hashchange", render);

    // Delegated handlers shared by several pages.
    document.addEventListener("click", (event) => {
      const exportButton = event.target.closest("[data-export-xlsx]");
      if (exportButton) {
        event.preventDefault();
        if (typeof AdminAuth === "undefined" || !AdminAuth.isUnlocked()) {
          toast("Admin password required for the Excel export", "bad");
          go("admin");
          return;
        }
        try {
          LocalDB.exportWorkbook();
          toast("Excel file downloaded", "ok");
        } catch (error) {
          toast(error.message, "bad");
        }
      }
    });

    // Keep visible stats fresh when the storage changed in another tab.
    window.addEventListener("storage", (event) => {
      if (event.key === LocalDB.STORAGE_KEY) {
        fillStats(LocalDB.stats());
        if (activeRoute === "admin" && routes.admin && routes.admin.enter) routes.admin.enter();
      }
    });

    setInterval(() => {
      if (document.visibilityState === "visible" && $$("[data-stat]").length) {
        fillStats(LocalDB.stats());
      }
    }, 12000);
  });

  return {
    $,
    $$,
    api,
    bootstrap,
    ticketLink,
    escapeHtml,
    initials,
    longDate,
    toast,
    qrSvg,
    absoluteUrl,
    beep,
    snow,
    confetti,
    hydrate,
    fillStats,
    statusPill,
    debounce,
    setBusy,
    copy,
    route,
    render,
    go,
    currentParams,
    currentName,
  };
})();
