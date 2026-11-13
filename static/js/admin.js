/* Admin: password-gated guest list, manual fixes, and the Excel import/export. */
(() => {
  const tbody = App.$("#attendee-rows");
  const search = App.$("#search");
  const filter = App.$("#status-filter");
  const errorBox = App.$("#admin-error");
  const tableCount = App.$("#table-count");
  const refreshBtn = App.$("#refresh");
  const storageNote = App.$("#storage-note");

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

  function ensureAccess() {
    if (!AdminAuth.configured()) {
      showLock("No admin password is configured. Run scripts/set_admin_password.py, then rebuild.");
      return;
    }
    if (AdminAuth.isUnlocked()) {
      showShell();
      load();
    } else {
      showLock("");
    }
  }

  if (!AdminAuth.configured()) {
    loginButton.disabled = true;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showLoginError("");
    App.setBusy(loginButton, true, "Checking…");
    try {
      const ok = await AdminAuth.attempt(passwordInput.value);
      if (!ok) {
        showLoginError("That password doesn't match. Try again.");
        passwordInput.value = "";
        const card = lockView.querySelector(".lock-card");
        card.classList.add("is-shaking");
        setTimeout(() => card.classList.remove("is-shaking"), 360);
        passwordInput.focus();
        return;
      }
      passwordInput.value = "";
      showShell();
      App.toast("Admin unlocked", "ok");
      await load();
    } catch (error) {
      showLoginError(error.message);
    } finally {
      App.setBusy(loginButton, false);
    }
  });

  lockButton.addEventListener("click", () => {
    AdminAuth.lock();
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
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No guests yet. Register someone, import an Excel file, or load the demo guests.</td></tr>`;
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
      showError(error.message);
    } finally {
      pending = false;
      refreshBtn.disabled = false;
    }
  }

  async function act(code, action) {
    if (!AdminAuth.isUnlocked()) return ensureAccess();
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

  /* -------------------------------------------------------------- Excel I/O */
  App.$("#import-file").addEventListener("change", async (event) => {
    if (!AdminAuth.isUnlocked()) return ensureAccess();
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const result = await LocalDB.importWorkbook(file);
      App.toast(
        `Imported ${result.added} · ${result.skipped} already listed · ${result.invalid} skipped`,
        "ok"
      );
      await load();
    } catch (error) {
      App.toast(error.message, "bad");
      showError(error.message);
    } finally {
      event.target.value = "";
    }
  });

  App.$("#seed-demo").addEventListener("click", () => {
    if (!AdminAuth.isUnlocked()) return ensureAccess();
    const result = LocalDB.seedDemo();
    App.toast(
      result.created ? `Added ${result.created} demo guests` : "Demo guests are already on the list",
      "ok"
    );
    load();
  });

  App.$("#clear-data").addEventListener("click", () => {
    if (!AdminAuth.isUnlocked()) return ensureAccess();
    const sure = window.confirm(
      "Delete every guest, check-in and winner from this browser? Export the Excel file first if you need a copy."
    );
    if (!sure) return;
    LocalDB.clearAll();
    App.toast("All data cleared", "ok");
    load();
  });

  App.$("#reset-draw").addEventListener("click", async () => {
    if (!AdminAuth.isUnlocked()) return ensureAccess();
    const sure = window.confirm(
      "Clear the Winners sheet? Everyone stays registered and checked in, but the draw history is gone."
    );
    if (!sure) return;
    try {
      await App.api("/api/draw/reset", { method: "POST", body: {} });
      App.toast("Winners sheet cleared", "ok");
      await load();
    } catch (error) {
      App.toast(error.message, "bad");
    }
  });

  if (!LocalDB.storageAvailable()) {
    storageNote.textContent =
      "⚠ This browser is blocking local storage, so data will disappear when the tab closes. Use a normal browser window, or export the Excel file often.";
    storageNote.style.color = "#8d2b27";
  } else {
    storageNote.textContent =
      "Stored in this browser only. Export the Excel file after the event — it's the backup.";
  }

  App.route("admin", { enter: ensureAccess });

  // Keep the table fresh if another tab checks someone in.
  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      App.currentName() === "admin" &&
      AdminAuth.isUnlocked() &&
      !pending
    ) {
      load();
    }
  }, 15000);

  ensureAccess();
})();
