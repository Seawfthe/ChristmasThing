/* ==========================================================================
   AdminAuth — the screen lock in front of the admin panel.

   The password is never stored in plain text. data/event.json keeps a
   PBKDF2-SHA256 salt + hash, and the browser derives the same hash from what
   you type. An unlock lasts for `admin.session_minutes`, in sessionStorage, so
   closing the tab (or pressing Lock) locks it again.

   This is a curtain, not a vault: the static build ships its database to the
   visitor, so anyone with devtools can read it. It stops students poking at
   the kiosk — real authorization lives in the Supabase build.
   ========================================================================== */

const AdminAuth = (() => {
  const SESSION_KEY = "christmas-thing.admin.session.v1";
  const config = (window.EVENT && window.EVENT.admin) || {};
  const passwordConfig = config.password || {};
  const sessionMinutes = Number(config.session_minutes) || 720;

  function hexToBytes(hex) {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
      throw new Error("The admin password hash in the config is malformed.");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  function toHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function constantTimeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async function derive(password, saltHex, iterations) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "This browser can't verify the password. Use Chrome, Edge, Firefox or Safari over https:// or localhost."
      );
    }
    const key = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: hexToBytes(saltHex),
        iterations,
        hash: "SHA-256",
      },
      key,
      256
    );
    return toHex(new Uint8Array(bits));
  }

  function configured() {
    return Boolean(passwordConfig.hash && passwordConfig.salt);
  }

  function session() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed.expires === "number" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function isUnlocked() {
    const current = session();
    return Boolean(current && current.expires > Date.now());
  }

  function expiresAt() {
    const current = session();
    return current && current.expires > Date.now() ? current.expires : null;
  }

  async function attempt(password) {
    if (!configured()) {
      throw new Error("No admin password is configured yet. Run scripts/set_admin_password.py.");
    }
    if (!password) return false;

    const digest = await derive(
      password,
      passwordConfig.salt,
      Number(passwordConfig.iterations) || 210000
    );
    if (!constantTimeEqual(digest, String(passwordConfig.hash).toLowerCase())) {
      return false;
    }

    try {
      window.sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ expires: Date.now() + sessionMinutes * 60 * 1000 })
      );
    } catch (_) {
      /* private mode may block sessionStorage; the unlock still works for this page */
    }
    return true;
  }

  function lock() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  return {
    configured,
    isUnlocked,
    expiresAt,
    attempt,
    lock,
    sessionMinutes,
  };
})();
