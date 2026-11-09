/* Door duty: camera → jsQR → POST /api/checkin, with a manual fallback. */
(() => {
  const video = App.$("#scan-video");
  const canvas = App.$("#scan-canvas");
  const idle = App.$("#scan-idle");
  const stage = App.$("#scan-stage");
  const flash = App.$("#scan-flash");
  const camState = App.$("#cam-state");
  const startBtn = App.$("#start-camera");
  const stopBtn = App.$("#stop-camera");
  const soundToggle = App.$("#sound-toggle");
  const resultCard = App.$("#scan-result");
  const log = App.$("#scan-log");
  const counter = App.$("#scan-counter");

  const CODE_RE = /CT-[A-Z0-9]{4}-[A-Z0-9]{4}/i;
  const LOOSE_RE = /\b[A-Z0-9]{8}\b/i;

  let stream = null;
  let running = false;
  let rafId = 0;
  let lastFrame = 0;
  let busy = false;
  const cooldown = new Map();
  let checkedIn = 0;
  let total = 0;

  function parseTicket(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const strict = raw.match(CODE_RE);
    if (strict) return strict[0].toUpperCase();
    const loose = raw.match(LOOSE_RE);
    if (loose) return `CT-${loose[0].slice(0, 4).toUpperCase()}-${loose[0].slice(4).toUpperCase()}`;
    return null;
  }

  function setCameraState(label) {
    camState.textContent = label;
  }

  function showResult(kind, name, meta) {
    resultCard.className = `scan-result ${kind}`;
    resultCard.innerHTML = `
      <span class="eyebrow">${kind === "ok" ? "Checked in" : kind === "warn" ? "Already in" : kind === "bad" ? "Not found" : "Ready"}</span>
      <p class="name">${App.escapeHtml(name)}</p>
      <p class="meta">${App.escapeHtml(meta)}</p>`;
    flash.className = `scan-flash ${kind === "ok" ? "ok" : kind === "warn" ? "warn" : kind === "bad" ? "bad" : ""}`;
    setTimeout(() => {
      flash.className = "scan-flash";
    }, 650);
  }

  function tone(kind) {
    if (soundToggle.checked) App.beep(kind);
    if (navigator.vibrate) navigator.vibrate(kind === "ok" ? 60 : [40, 40, 40]);
  }

  function prependLog(name, when) {
    const empty = log.querySelector(".who")?.textContent === "No one yet tonight";
    if (empty) log.innerHTML = "";
    const row = document.createElement("li");
    row.innerHTML = `<span class="who">${App.escapeHtml(name)}</span><span class="when">${App.escapeHtml(when)}</span>`;
    log.prepend(row);
    while (log.children.length > 8) log.lastElementChild.remove();
  }

  function refreshCounter() {
    counter.textContent = `${checkedIn} of ${total}`;
  }

  async function checkIn(raw, source) {
    const code = parseTicket(raw);
    if (!code) {
      showResult("bad", "That's not a ticket", "Look for a code shaped like CT-XXXX-XXXX.");
      tone("bad");
      return;
    }

    const now = Date.now();
    if ((cooldown.get(code) || 0) > now) return;

    busy = true;
    try {
      const data = await App.api("/api/checkin", { method: "POST", body: { code, source } });
      const attendee = data.attendee;
      cooldown.set(code, Date.now() + 4000);

      if (data.already_checked_in) {
        showResult("warn", attendee.name, `Already checked in at ${data.checked_in_at || "earlier"}.`);
        tone("warn");
      } else {
        showResult("ok", attendee.name, `${attendee.ticket_id} · checked in just now`);
        tone("ok");
        prependLog(attendee.name, "just now");
        const stats = data.stats;
        if (stats) {
          checkedIn = stats.checked_in;
          total = stats.registered;
          App.fillStats(stats);
          refreshCounter();
        }
        if (navigator.vibrate) navigator.vibrate(70);
      }
      if (!data.already_checked_in && data.attendee) App.toast(`${attendee.name} is in`, "ok");
    } catch (error) {
      showResult("bad", "Couldn't check in", error.message);
      tone("bad");
      App.toast(error.message, "bad");
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------------------ camera */
  function scanFrame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(scanFrame);
    if (now - lastFrame < 120) return;
    lastFrame = now;

    if (video.readyState !== video.HAVE_ENOUGH_DATA || !video.videoWidth) return;

    const maxSide = 720;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);

    const found = window.jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
    if (found && found.data && !busy) {
      checkIn(found.data, "scan");
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      idle.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
        <p>No camera available here</p>
        <p class="tiny" style="max-width:32ch">Browsers only allow camera access on <code>http://127.0.0.1</code> or HTTPS. Open this page on the desk laptop, or type codes in instead.</p>`;
      return;
    }

    startBtn.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      idle.classList.add("hidden");
      startBtn.disabled = false;
      stopBtn.disabled = false;
      setCameraState("Camera live — scanning");
      rafId = requestAnimationFrame(scanFrame);
    } catch (error) {
      startBtn.disabled = false;
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      App.toast(
        denied ? "Camera permission denied — you can still type codes." : "Couldn't start the camera.",
        "bad"
      );
      idle.querySelector("p").textContent = denied ? "Camera permission denied" : "Camera unavailable";
      setCameraState("Camera off");
    }
  }

  function stopCamera() {
    running = false;
    cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    idle.classList.remove("hidden");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setCameraState("Camera off");
  }

  /* ------------------------------------------------------------------- wiring */
  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", stopCamera);

  App.$("#manual-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = App.$("#manual-code");
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    checkIn(value, "manual");
    input.value = "";
    input.focus();
  });

  App.bootstrap()
    .then((data) => {
      total = data.stats.registered;
      checkedIn = data.stats.checked_in;
      refreshCounter();

      const recent = data.recent || [];
      if (recent.length) {
        log.innerHTML = "";
        recent.forEach((entry) => prependLog(entry.name, entry.checked_in_at.slice(11) || entry.checked_in_at));
      }
    })
    .catch(() => {});

  // Refresh the counter quietly while the desk is open.
  setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const data = await App.api("/api/stats");
      checkedIn = data.stats.checked_in;
      total = data.stats.registered;
      refreshCounter();
    } catch (_) {
      /* ignore */
    }
  }, 20000);
})();
