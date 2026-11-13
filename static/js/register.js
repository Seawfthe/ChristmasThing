/* Registration page — form → Excel row → QR ticket. */
(() => {
  const form = App.$("#register-form");
  const errorBox = App.$("#form-error");
  const submitBtn = App.$("#submit-btn");
  const formCard = App.$("#form-card");
  const successCard = App.$("#success-card");
  const countNode = App.$("#people-count");

  let lastTicketUrl = "";

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const clearError = () => errorBox.classList.add("hidden");

  function renderTicket(data) {
    const attendee = data.attendee;
    lastTicketUrl = App.ticketLink(attendee.ticket_id);
    App.$("#success-qr").innerHTML = App.qrSvg(lastTicketUrl, { cellSize: 7, margin: 2, alt: `Ticket for ${attendee.name}` });
    App.$("#success-name").textContent = attendee.name;
    App.$("#success-team").textContent = [attendee.team, attendee.role].filter(Boolean).join(" · ");
    App.$("#success-code").textContent = attendee.ticket_id;
    App.$("#open-ticket").href = data.ticket_url;
    App.$("#success-eyebrow").textContent = data.already_registered ? "Already on the list" : "You're in";
    App.$("#success-title").textContent = data.already_registered
      ? `We know you, ${attendee.name.split(" ")[0]}`
      : `Welcome to the list, ${attendee.name.split(" ")[0]}`;
    App.$("#success-sub").textContent = data.already_registered
      ? "That email is already registered, so here's your original ticket — no duplicate row in the sheet."
      : "Your row is in the Excel sheet and your QR is ready. Show it at the door.";

    formCard.classList.add("hidden");
    successCard.classList.remove("hidden");
    successCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const payload = Object.fromEntries(new FormData(form).entries());
    if (!payload.name || payload.name.trim().length < 2) {
      showError("Please give us a name — at least two characters.");
      App.$("#name").focus();
      return;
    }
    if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email.trim())) {
      showError("That email doesn't look quite right.");
      App.$("#email").focus();
      return;
    }

    App.setBusy(submitBtn, true, "Minting your ticket…");
    try {
      const data = await App.api("/api/register", { method: "POST", body: payload });
      renderTicket(data);
      App.toast(data.already_registered ? "Found your existing ticket" : "Ticket created", "ok");
    } catch (error) {
      showError(error.message);
    } finally {
      App.setBusy(submitBtn, false);
    }
  });

  App.$("#copy-ticket").addEventListener("click", () => {
    if (lastTicketUrl) App.copy(lastTicketUrl);
  });

  App.$("#register-another").addEventListener("click", () => {
    form.reset();
    successCard.classList.add("hidden");
    formCard.classList.remove("hidden");
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
    App.$("#name").focus();
  });

  App.bootstrap()
    .then((data) => {
      const total = data.stats.registered;
      countNode.textContent = total
        ? `${total} ${total === 1 ? "person is" : "people are"} already on the list.`
        : "You'd be the first name on the list.";
    })
    .catch(() => {});
})();
