/* Admin: the guest list, manual fixes, and the Excel download. */
(() => {
  const tbody = App.$("#attendee-rows");
  const search = App.$("#search");
  const filter = App.$("#status-filter");
  const errorBox = App.$("#admin-error");
  const tableCount = App.$("#table-count");
  const refreshBtn = App.$("#refresh");

  let pending = false;

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  };

  const clearError = () => errorBox.classList.add("hidden");

  function renderRows(attendees) {
    if (!attendees.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Nobody matches that. Try a different search.</td></tr>`;
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

  async function load({ quiet = false } = {}) {
    if (pending) return;
    pending = true;
    if (!quiet) refreshBtn.disabled = true;
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
      await load({ quiet: true });
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

  search.addEventListener("input", App.debounce(() => load({ quiet: true }), 260));
  filter.addEventListener("change", () => load());
  refreshBtn.addEventListener("click", () => load());

  App.$("#reset-draw").addEventListener("click", async () => {
    const sure = window.confirm(
      "Clear the Winners sheet? Everyone stays registered and checked in, but the draw history is gone."
    );
    if (!sure) return;
    try {
      await App.api("/api/draw/reset", { method: "POST", body: {} });
      App.toast("Winners sheet cleared", "ok");
      await load({ quiet: true });
    } catch (error) {
      App.toast(error.message, "bad");
    }
  });

  setInterval(() => {
    if (document.visibilityState === "visible" && !pending) load({ quiet: true });
  }, 10000);

  load();
})();
