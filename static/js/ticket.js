/* Ticket lookup: a code shows one ticket, a name shows a short list. */
(() => {
  const input = App.$("#lookup-input");
  const form = App.$("#lookup-form");
  const errorBox = App.$("#lookup-error");
  const results = App.$("#results");
  const resultList = App.$("#result-list");
  const ticketView = App.$("#ticket-view");
  const hint = App.$("#lookup-hint");
  const button = App.$("#lookup-btn");

  const CODE_RE = /CT-[A-Z0-9]{4}-[A-Z0-9]{4}/i;

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  };

  const clearError = () => errorBox.classList.add("hidden");

  function ticketUrlFor(code) {
    return App.ticketLink(code);
  }

  function showTicket(attendee) {
    results.classList.add("hidden");
    ticketView.classList.remove("hidden");
    clearError();

    const qrText = ticketUrlFor(attendee.ticket_id);
    App.$("#ticket-qr").innerHTML = App.qrSvg(qrText, {
      cellSize: 7,
      margin: 2,
      alt: `QR ticket for ${attendee.name}`,
    });
    App.$("#ticket-name").textContent = attendee.name;
    App.$("#ticket-team").textContent = [attendee.team, attendee.role].filter(Boolean).join(" · ");
    App.$("#ticket-code-text").textContent = attendee.ticket_id;

    const present = String(attendee.status || "").toLowerCase().includes("checked");
    const statusNode = App.$("#ticket-status");
    statusNode.textContent = present
      ? `Checked in ${attendee.checked_in_at || ""}`.trim()
      : attendee.status || "Registered";
    statusNode.style.color = present ? "#1e4d3a" : "";
    App.$("#ticket").classList.toggle("is-present", present);

    App.$("#ticket-footnote").textContent = present
      ? "You're already scanned in. The desk will see this if you scan again."
      : "Hand this screen to the desk, or let them scan the code from your phone.";

    App.$("#copy-link").onclick = () => App.copy(App.ticketLink(attendee.ticket_id));
    App.$("#copy-code").onclick = () => App.copy(attendee.ticket_id);
  }

  function showResults(attendees) {
    ticketView.classList.add("hidden");
    resultList.innerHTML = attendees
      .map(
        (attendee) => `
        <button class="result-row" type="button" data-code="${App.escapeHtml(attendee.ticket_id)}">
          <span class="result-avatar">${App.escapeHtml(App.initials(attendee.name))}</span>
          <span class="result-body">
            <span class="result-name">${App.escapeHtml(attendee.name)}</span>
            <span class="result-meta">${App.escapeHtml(attendee.ticket_id)} · ${App.escapeHtml(attendee.status || "Registered")}</span>
          </span>
          <span class="result-arrow">→</span>
        </button>`
      )
      .join("");
    results.classList.remove("hidden");

    App.$$(".result-row", resultList).forEach((row) => {
      row.addEventListener("click", () => loadCode(row.dataset.code));
    });
  }

  async function loadCode(code) {
    clearError();
    App.setBusy(button, true, "Looking…");
    try {
      const data = await App.api(`/api/ticket/${encodeURIComponent(code)}`);
      showTicket(data.attendee);
      const target = `#/ticket?code=${encodeURIComponent(data.attendee.ticket_id)}`;
      if (App.currentParams().get("code") !== data.attendee.ticket_id) {
        window.history.replaceState(null, "", target);
      }
    } catch (error) {
      showError(error.message);
    } finally {
      App.setBusy(button, false);
    }
  }

  async function search(query) {
    clearError();
    ticketView.classList.add("hidden");
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      showError("Type a ticket code or a name first.");
      return;
    }

    const match = trimmed.match(CODE_RE);
    if (match) {
      input.value = match[0].toUpperCase();
      return loadCode(match[0].toUpperCase());
    }

    App.setBusy(button, true, "Searching…");
    try {
      const data = await App.api(`/api/lookup?query=${encodeURIComponent(trimmed)}`);
      const rows = data.attendees || [];
      if (!rows.length) {
        showError(`No one matches “${trimmed}”. Check the spelling, or use the ticket ID.`);
        return;
      }
      if (rows.length === 1) {
        return showTicket(rows[0]);
      }
      hint.textContent = `${rows.length} people match — pick yours.`;
      showResults(rows);
    } catch (error) {
      showError(error.message);
    } finally {
      App.setBusy(button, false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    search(input.value);
  });

  App.$("#print-ticket").addEventListener("click", () => window.print());

  App.route("ticket", {
    enter(params) {
      const code = params.get("code");
      if (code) {
        input.value = code;
        loadCode(code);
      } else {
        results.classList.add("hidden");
        ticketView.classList.add("hidden");
        clearError();
        setTimeout(() => input.focus(), 60);
      }
    },
  });
})();
