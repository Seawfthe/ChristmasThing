/* Shared helpers for every page: API calls, toasts, QR codes, snow, chrome. */
const App = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let bootstrapPromise = null;

  /* ------------------------------------------------------------- networking */
  async function api(path, options = {}) {
    const { method = "GET", body } = options;
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* empty body is fine */
    }
    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status})`);
      error.code = data && data.code;
      error.status = res.status;
      throw error;
    }
    return data || {};
  }

  function bootstrap() {
    if (!bootstrapPromise) {
      bootstrapPromise = api("/api/bootstrap").catch((error) => {
        bootstrapPromise = null;
        throw error;
      });
    }
    return bootstrapPromise;
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
    const stack = $("#toast-stack") || (() => {
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
      /* sound is a bonus, never a requirement */
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

  /* ------------------------------------------------------------------ chrome */
  function markActiveNav() {
    const current = window.location.pathname.split("/").pop() || "index.html";
    $$(".nav a").forEach((link) => {
      const target = link.getAttribute("href");
      if (target === current) link.classList.add("is-active");
    });
  }

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
    set("[data-event='weekday']", parseDate(event.date)?.toLocaleString("en-GB", { weekday: "long" }) || "Saturday");
    document.title = document.title.replace("The Christmas Thing", event.name || "The Christmas Thing");
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
    try {
      const data = await bootstrap();
      fillEventFields(data.event);
      if (stats) fillStats(data.stats);
      return data;
    } catch (error) {
      console.warn("Could not load event data:", error.message);
      return null;
    }
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

  document.addEventListener("DOMContentLoaded", () => {
    markActiveNav();
    snow();
    hydrate();
    // Keep the little live stats fresh on pages that show them.
    setInterval(() => {
      if (document.visibilityState === "visible" && $$("[data-stat]").length) {
        api("/api/stats")
          .then((data) => fillStats(data.stats))
          .catch(() => {});
      }
    }, 15000);
  });

  return {
    $,
    $$,
    api,
    bootstrap,
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
  };
})();
