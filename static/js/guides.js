/* Guides: rendered from data/guides.json so non-coders can edit the copy. */
(() => {
  const ICONS = {
    ticket:
      '<path d="M4 8V5a1 1 0 011-1h3M20 8V5a1 1 0 00-1-1h-3M4 16v3a1 1 0 001 1h3M20 16v3a1 1 0 01-1 1h-3"/><path d="M8 12h8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    gift: '<path d="M4 10h16v10H4z"/><path d="M12 10v10M4 10V7h16v3M12 7c-2-3-6-2-5 1 .6 1.7 3.2 2 5 2zM12 7c2-3 6-2 5 1-.6 1.7-3.2 2-5 2z"/>',
    plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    sparkle: '<path d="M12 3l2 5.5L20 10l-4.5 4 1.2 6L12 17l-4.7 3 1.2-6L4 10l6-1.5L12 3z"/>',
    heart: '<path d="M12 20s-7-4.3-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.7-7 9-7 9z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a12 12 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"/>',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${
      ICONS[name] || ICONS.sparkle
    }</svg>`;
  }

  function render(guides) {
    const toc = App.$("#toc");
    const host = App.$("#guides");

    toc.innerHTML = guides
      .map((guide) => `<a href="#${App.escapeHtml(guide.id)}">${App.escapeHtml(guide.title)}</a>`)
      .join("");

    host.innerHTML = guides
      .map(
        (guide) => `
        <article class="guide" id="${App.escapeHtml(guide.id)}">
          <div class="guide-head">
            <span class="guide-icon">${icon(guide.icon)}</span>
            <div>
              <h2>${App.escapeHtml(guide.title)}</h2>
              <p class="guide-summary">${App.escapeHtml(guide.summary || "")}</p>
            </div>
          </div>
          ${(guide.sections || [])
            .map(
              (section) => `
            <div class="guide-section">
              <h3>${App.escapeHtml(section.heading)}</h3>
              ${(section.body || []).map((line) => `<p>${App.escapeHtml(line)}</p>`).join("")}
            </div>`
            )
            .join("")}
        </article>`
      )
      .join("");

    // Scroll-spy: highlight the section you're reading.
    const links = App.$$("#toc a");
    if (links[0]) links[0].classList.add("is-active");
    const byId = new Map(links.map((link) => [link.getAttribute("href").slice(1), link]));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove("is-active"));
          const active = byId.get(entry.target.id);
          if (active) active.classList.add("is-active");
        });
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    App.$$(".guide").forEach((section) => observer.observe(section));
  }

  App.bootstrap()
    .then((data) => render(data.guides || []))
    .catch((error) => {
      App.$("#guides").innerHTML = `<div class="form-error">Couldn't load the guides: ${App.escapeHtml(
        error.message
      )}</div>`;
    });
})();
