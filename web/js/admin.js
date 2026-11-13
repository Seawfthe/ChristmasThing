/* Admin: password-gated guest list, manual fixes, and the Excel download. */
(() => {
  const tbody = App.$("#attendee-rows");
  const search = App.$("#search");
  const filter = App.$("#status-filter");
  const errorBox = App.$("#admin-error");
  const tableCount = App.$("#table-count");
  const refreshBtn = App.$("#refresh");

  const lockView = App.$("#admin-lock");
  const shell = App.$("#admin-shell");
  const loginForm = App.$("#admin-login-form");
  const passwordInput = App.$("#admin-password");
  const loginButton = App.$("#admin-login-btn");
  const loginError = App.$("#admin-login-error");
  const lockButton = App.$("#lock-admin");

  let pending = false;

  /* ---------------------------------------------------------------- gating */
  function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.toggle("hidden", !message);
  }

  function showLock(message) {
    lockView.classList.remove("hidden");
    shell.classList.add("hidden");
    showLoginError(message || "");
    setTimeout(() => passwordInput.focus(), 80);
  }

  function showShell() {
    lockView.classList.add("hidden");
    shell.classList.remove("hidden");
    showLoginError("");
  }

  function shake() {
    const card = lockView.querySelector(".lock-card");
    card.classList.add("is-shaking");
    setTimeout(() => card.classList.remove("is-shaking"), 360);
  }

  async function ensureAccess() {
    const unlocked = await AdminAuth.refresh();
    if (unlocked) {
      showShell();
      await load();
    } else {
      showLock("");
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showLoginError("");
    App.setBusy(loginButton, true, "Checking…");
    try {
      await AdminAuth.login(passwordInput.value);
      passwordInput.value = "";
      showShell();
      App.toast("Admin unlocked", "ok");
      await load();
    } catch (error) {
      passwordInput.value = "";
      showLoginError(
        error.status === 429
          ? "Too many attempts. Wait a few minutes, then try again."
          : error.message || "That password doesn't match."
      );
      shake();
      passwordInput.focus();
    } finally {
      App.setBusy(loginButton, false);
    }
  });

  lockButton.addEventListener("click", async () => {
    await AdminAuth.logout();
    showLock("");
    App.toast("Admin locked", "");
  });

  /* ------------------------------------------------------------------ data */
  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  };

  const clearError = () => errorBox.classList.add("hidden");

  function renderRows(attendees) {
    if (!attendees.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No guests yet. Register someone, or import a list.</td></tr>`;
      return;
    }

    tbody.innerHTML = attendees
      .map((attendee) => {
        const present = String(attendee.status || "").toLowerCase().includes("checked");
        return `
        <tr>
          <td>
            <span class="who">${App.escapeHtml(attendee.name)}</span>
            <span class="sub">${App.escapeHtml(attendee.email || attendee.role || "")}</span>
          </td>
          <td><span class="code">${App.escapeHtml(attendee.ticket_id)}</span></td>
          <td>${App.escapeHtml(attendee.team || "—")}</td>
          <td>${App.escapeHtml(attendee.registered_at || "—")}</td>
          <td>${App.statusPill(attendee.status)}</td>
          <td>${App.escapeHtml(attendee.checked_in_at || "—")}</td>
          <td style="text-align: right; white-space: nowrap">
            <button
              class="btn ${present ? "btn-quiet" : ""} btn-sm"
              type="button"
              data-code="${App.escapeHtml(attendee.ticket_id)}"
              data-action="${present ? "undo" : "checkin"}"
            >${present ? "Undo" : "Check in"}</button>
          </td>
        </tr>`;
      })
      .join("");
  }

  async function load() {
    if (!AdminAuth.isUnlocked() || pending) return;
    pending = true;
    refreshBtn.disabled = true;
    try {
      const query = search.value.trim();
      const status = filter.value;
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (status && status !== "all") params.set("status", status);
      const data = await App.api(`/api/attendees?${params.toString()}`);
      renderRows(data.attendees || []);
      App.fillStats(data.stats);
      tableCount.textContent = `${data.attendees.length} of ${data.stats.registered} guests shown · ${data.stats.check_in_rate}% checked in`;
      clearError();
    } catch (error) {
      if (error.status === 401) {
        showLock("Session expired — unlock again.");
        return;
      }
      showError(error.message);
    } finally {
      pending = false;
      refreshBtn.disabled = false;
    }
  }

  async function act(code, action) {
    if (!AdminAuth.isUnlocked()) return showLock("Session expired — unlock again.");
    pending = true;
    try {
      if (action === "undo") {
        await App.api("/api/checkin/undo", { method: "POST", body: { code } });
        App.toast("Check-in removed", "");
      } else {
        const data = await App.api("/api/checkin", { method: "POST", body: { code, source: "admin" } });
        App.toast(
          data.already_checked_in ? `${data.attendee.name} was already in` : `${data.attendee.name} checked in`,
          data.already_checked_in ? "bad" : "ok"
        );
      }
      await load();
    } catch (error) {
      if (error.status === 401) {
        showLock("Session expired — unlock again.");
        return;
      }
      App.toast(error.message, "bad");
      showError(error.message);
    } finally {
      pending = false;
    }
  }

  tbody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-code]");
    if (!button) return;
    act(button.dataset.code, button.dataset.action);
  });

  search.addEventListener("input", App.debounce(() => load(), 260));
  filter.addEventListener("change", () => load());
  refreshBtn.addEventListener("click", () => load());

  App.$("#reset-draw").addEventListener("click", async () => {
    if (!AdminAuth.isUnlocked()) return showLock("Session expired — unlock again.");
    const sure = window.confirm(
      "Clear the Winners sheet? Everyone stays registered and checked in, but the draw history is gone."
    );
    if (!sure) return;
    try {
      await App.api("/api/draw/reset", { method: "POST", body: {} });
      App.toast("Winners sheet cleared", "ok");
      await load();
    } catch (error) {
      if (error.status === 401) return showLock("Session expired — unlock again.");
      App.toast(error.message, "bad");
    }
  });

  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      AdminAuth.isUnlocked() &&
      !pending
    ) {
      load();
    }
  }, 15000);

  ensureAccess();
})();
