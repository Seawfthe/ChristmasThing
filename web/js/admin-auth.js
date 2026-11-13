/* AdminAuth for the Python build — sessions live in an HttpOnly cookie. */
const AdminAuth = (() => {
  let authenticated = false;
  let ttlSeconds = 0;

  async function refresh() {
    try {
      const res = await fetch("/api/admin/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        authenticated = false;
        return false;
      }
      const data = await res.json();
      authenticated = Boolean(data.authenticated);
      return authenticated;
    } catch (_) {
      authenticated = false;
      return false;
    }
  }

  async function login(password) {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* empty body is fine */
    }
    if (!res.ok) {
      const error = new Error(data.error || "Login failed.");
      error.status = res.status;
      throw error;
    }
    authenticated = true;
    ttlSeconds = Number(data.expires_in) || 0;
    return true;
  }

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    } catch (_) {
      /* server may be down; still lock the UI */
    } finally {
      authenticated = false;
    }
  }

  return {
    refresh,
    login,
    logout,
    isUnlocked: () => authenticated,
    ttlSeconds: () => ttlSeconds,
  };
})();
