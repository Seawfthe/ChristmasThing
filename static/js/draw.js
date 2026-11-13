/* Lucky draw: the winner is picked from the local database, the page makes it dramatic. */
(() => {
  const reel = App.$("#reel");
  const reelPrize = App.$("#reel-prize");
  const reelSub = App.$("#reel-sub");
  const drawBtn = App.$("#draw-btn");
  const prizeSelect = App.$("#prize-select");
  const prizeCustom = App.$("#prize-custom");
  const eligibleSelect = App.$("#eligible-select");
  const allowRepeat = App.$("#allow-repeat");
  const poolNote = App.$("#pool-note");
  const historyNode = App.$("#draw-history");

  let prizes = [];
  let drawing = false;

  function selectedPrize() {
    const custom = prizeCustom.value.trim();
    if (custom) return custom;
    return prizeSelect.value || "Mystery prize";
  }

  function renderHistory(winners) {
    if (!winners || !winners.length) {
      historyNode.innerHTML = `<p class="tiny" style="color: var(--ink-mute)">No prizes drawn yet.</p>`;
      return;
    }
    historyNode.innerHTML = [...winners]
      .reverse()
      .map(
        (winner) => `
        <div class="entry">
          <div>
            <strong>${App.escapeHtml(winner.name)}</strong>
            <span style="display:block">${App.escapeHtml(winner.prize)}</span>
          </div>
          <span>#${App.escapeHtml(winner.draw_no)} · ${App.escapeHtml((winner.drawn_at || "").slice(11) || winner.drawn_at || "")}</span>
        </div>`
      )
      .join("");
  }

  async function loadHistory() {
    try {
      const data = await App.api("/api/draw/history");
      renderHistory(data.winners);
      App.fillStats(data.stats);
    } catch (_) {
      /* the reel still works without history */
    }
  }

  function roll(winner, candidates, duration = 2500) {
    return new Promise((resolve) => {
      const start = performance.now();
      let lastSwap = 0;
      reel.classList.add("is-rolling");
      reel.classList.remove("is-winner");

      function frame(now) {
        const elapsed = now - start;
        const progress = Math.min(1, elapsed / duration);
        const interval = 42 + progress ** 3 * 240;
        if (now - lastSwap >= interval) {
          lastSwap = now;
          const name = candidates[Math.floor(Math.random() * candidates.length)] || winner.name;
          reel.textContent = name;
        }
        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          reel.textContent = winner.name;
          reel.classList.remove("is-rolling");
          reel.classList.add("is-winner");
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function doDraw() {
    if (drawing) return;
    drawing = true;
    App.setBusy(drawBtn, true, "Drawing…");
    reelSub.textContent = "The room goes quiet…";
    App.beep("warn");

    const prize = selectedPrize();
    reelPrize.textContent = prize;

    try {
      const data = await App.api("/api/draw", {
        method: "POST",
        body: {
          prize,
          eligible: eligibleSelect.value,
          allow_repeat: allowRepeat.checked,
        },
      });

      await roll(data.winner, data.candidates || [data.winner.name]);

      App.confetti();
      App.beep("ok");
      reelSub.textContent = `Winner of ${data.prize} · drawn from ${data.pool_size} ${data.pool_label}`;
      App.toast(`${data.winner.name} wins ${data.prize}`, "ok");
      await loadHistory();
    } catch (error) {
      reel.classList.remove("is-rolling");
      reelSub.textContent = error.message;
      App.toast(error.message, "bad");
    } finally {
      drawing = false;
      App.setBusy(drawBtn, false);
    }
  }

  function refresh() {
    const stats = LocalDB.stats();
    App.fillStats(stats);
    poolNote.textContent = `${stats.checked_in} checked in · ${stats.pending} still to arrive · ${stats.prizes_awarded} prizes already drawn.`;
    loadHistory();
  }

  drawBtn.addEventListener("click", doDraw);

  // Space bar as the big red button, for when the host is holding a microphone.
  document.addEventListener("keydown", (event) => {
    if (
      event.code === "Space" &&
      App.currentName() === "draw" &&
      document.activeElement === document.body
    ) {
      event.preventDefault();
      doDraw();
    }
  });

  prizeSelect.addEventListener("change", () => {
    reelPrize.textContent = selectedPrize();
  });

  App.bootstrap().then((data) => {
    prizes = (data.event && data.event.prizes) || [];
    prizeSelect.innerHTML = prizes.map((prize) => `<option>${App.escapeHtml(prize)}</option>`).join("");
    if (!prizes.length) prizeSelect.innerHTML = `<option value="Mystery prize">Mystery prize</option>`;
    reelPrize.textContent = selectedPrize();
    refresh();
  });

  App.route("draw", { enter: refresh });
})();
