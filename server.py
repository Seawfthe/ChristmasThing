#!/usr/bin/env python3
"""Christmas Thing — one command to run the whole event site.

    python server.py            # http://127.0.0.1:8000
    python server.py --open     # ...and open the browser
    python server.py --port 9000 --host 0.0.0.0

Static files come from web/. Everything under /api/ is JSON. The database is
data/attendees.xlsx, which is a normal Excel file you can open and edit.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import socket
import sys
import threading
import time
import traceback
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from app.auth import SessionStore, verify_password
from app.config import EventConfig
from app.service import EventService
from app.store import ExcelStore, StoreError

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DATA_DIR = BASE_DIR / "data"
WORKBOOK = DATA_DIR / "attendees.xlsx"

MAX_BODY = 2 * 1024 * 1024
COOKIE_NAME = "ct_admin"
LOGIN_WINDOW = 300  # seconds
LOGIN_MAX_ATTEMPTS = 8

STATUS_BY_CODE = {
    "validation": 400,
    "unauthorized": 401,
    "rate_limited": 429,
    "not_found": 404,
    "file_locked": 409,
    "empty_pool": 409,
    "bad_workbook": 422,
    "missing_dependency": 503,
}

MIME_OVERRIDES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
}


def lan_ip() -> str:
    """Best-effort LAN address so phones can reach the site."""
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        address = probe.getsockname()[0]
        probe.close()
        return address
    except OSError:
        return ""


class Handler(BaseHTTPRequestHandler):
    server_version = "ChristmasThing/0.3"
    service: EventService  # injected by build_server
    sessions: SessionStore  # injected by build_server

    _login_attempts: dict[str, list[float]] = {}
    _login_lock = threading.Lock()

    # ------------------------------------------------------------- plumbing
    def log_message(self, fmt: str, *args) -> None:  # quieter console
        if "/api/" in (self.path or ""):
            print(f"  · {self.command} {self.path.split('?')[0]} → {args[1] if len(args) > 1 else ''}")

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        try:
            if path.startswith("/api/"):
                self._handle_api(method, path, parse_qs(parsed.query))
            elif method == "GET":
                self._handle_static(path)
            else:
                self._json({"error": "Not found", "code": "not_found"}, 404)
        except StoreError as exc:
            self._json({"error": exc.message, "code": exc.code}, STATUS_BY_CODE.get(exc.code, 400))
        except Exception as exc:  # noqa: BLE001 - last-resort guard
            traceback.print_exc()
            self._json({"error": f"Server error: {exc}", "code": "server_error"}, 500)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise StoreError("Request body too large.", "validation")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StoreError("Invalid JSON body.", "validation") from exc
        if not isinstance(payload, dict):
            raise StoreError("Expected a JSON object.", "validation")
        return payload

    def _json(self, payload, status: int = 200, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------------------------------------ admin auth
    def _session_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            cookie = SimpleCookie(raw)
        except Exception:  # noqa: BLE001 - malformed cookie header
            return None
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def _is_admin(self) -> bool:
        return self.sessions.valid(self._session_token())

    def _require_admin(self) -> None:
        if not self._is_admin():
            raise StoreError("Admin login required.", "unauthorized")

    def _session_cookie(self, value: str, max_age: int) -> str:
        cookie = SimpleCookie()
        cookie[COOKIE_NAME] = value
        cookie[COOKIE_NAME]["path"] = "/"
        cookie[COOKIE_NAME]["httponly"] = True
        cookie[COOKIE_NAME]["samesite"] = "Strict"
        cookie[COOKIE_NAME]["max-age"] = max_age
        return cookie.output(header="").strip()

    def _login_allowed(self) -> bool:
        ip = self.client_address[0] if self.client_address else "?"
        now = time.time()
        with Handler._login_lock:
            attempts = [
                stamp for stamp in Handler._login_attempts.get(ip, []) if now - stamp < LOGIN_WINDOW
            ]
            Handler._login_attempts[ip] = attempts
            if len(attempts) >= LOGIN_MAX_ATTEMPTS:
                return False
            attempts.append(now)
            return True

    def _admin_login(self, body: dict) -> None:
        if not self._login_allowed():
            raise StoreError("Too many attempts. Wait a few minutes and try again.", "rate_limited")
        password_config = ((self.service.config().get("admin") or {}).get("password")) or {}
        if not password_config.get("hash"):
            raise StoreError(
                "No admin password is configured. Run scripts/set_admin_password.py.",
                "missing_dependency",
            )
        password = str(body.get("password") or "")
        if not verify_password(password, self.service.config()):
            time.sleep(0.25)  # slow down guessing
            raise StoreError("That password doesn't match.", "unauthorized")
        token, ttl = self.sessions.create()
        self._json(
            {"ok": True, "expires_in": ttl},
            headers={"Set-Cookie": self._session_cookie(token, ttl)},
        )

    def _admin_logout(self) -> None:
        self.sessions.destroy(self._session_token())
        self._json({"ok": True}, headers={"Set-Cookie": self._session_cookie("", 0)})

    # ------------------------------------------------------------------ API
    def _handle_api(self, method: str, path: str, query: dict[str, list[str]]) -> None:
        service = self.service
        q = lambda name, default="": (query.get(name, [default]) or [default])[0]

        if method == "POST" and path == "/api/admin/login":
            return self._admin_login(self._body())

        if method == "POST" and path == "/api/admin/logout":
            return self._admin_logout()

        if method == "GET" and path == "/api/admin/session":
            return self._json({"authenticated": self._is_admin()})

        if method == "GET" and path == "/api/bootstrap":
            return self._json(service.bootstrap())

        if method == "GET" and path == "/api/stats":
            return self._json({"stats": service.stats()})

        if method == "GET" and path == "/api/lookup":
            return self._json({"attendees": service.lookup(query=q("query"))})

        if method == "GET" and path == "/api/attendees":
            self._require_admin()
            return self._json(
                {
                    "attendees": service.attendees(query=q("query"), status=q("status")),
                    "stats": service.stats(),
                }
            )

        if method == "GET" and path.startswith("/api/ticket/"):
            code = path.split("/api/ticket/", 1)[1]
            attendee = service.ticket(code)
            if attendee is None:
                raise StoreError("No ticket with that code.", "not_found")
            return self._json({"attendee": attendee})

        if method == "GET" and path == "/api/draw/history":
            return self._json(service.draw_history())

        if method == "GET" and path == "/api/export":
            self._require_admin()
            return self._send_workbook()

        if method == "POST" and path == "/api/register":
            return self._json(service.register(self._body()), 201)

        if method == "POST" and path == "/api/checkin":
            body = self._body()
            return self._json(service.check_in(body.get("code", ""), body.get("source", "scan")))

        if method == "POST" and path == "/api/checkin/undo":
            self._require_admin()
            body = self._body()
            return self._json(service.undo_check_in(body.get("code", "")))

        if method == "POST" and path == "/api/draw":
            body = self._body()
            return self._json(
                service.draw(
                    prize=body.get("prize", ""),
                    eligible=body.get("eligible", "checked_in"),
                    allow_repeat=bool(body.get("allow_repeat", False)),
                )
            )

        if method == "POST" and path == "/api/draw/reset":
            self._require_admin()
            return self._json(service.reset_draw())

        raise StoreError("Unknown endpoint.", "not_found")

    def _send_workbook(self) -> None:
        workbook: Path = self.service.store.path
        if not workbook.exists():
            raise StoreError("The workbook hasn't been created yet.", "not_found")
        data = workbook.read_bytes()
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.send_header("Content-Disposition", 'attachment; filename="attendees.xlsx"')
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # --------------------------------------------------------------- static
    def _handle_static(self, path: str) -> None:
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        if rel.endswith("/"):
            rel += "index.html"
        target = (WEB_DIR / rel).resolve()
        try:
            target.relative_to(WEB_DIR.resolve())
        except ValueError:
            return self._not_found()
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self._not_found()

        data = target.read_bytes()
        content_type = MIME_OVERRIDES.get(target.suffix.lower()) or mimetypes.guess_type(
            target.name
        )[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _not_found(self) -> None:
        page = WEB_DIR / "404.html"
        if page.is_file():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._json({"error": "Not found", "code": "not_found"}, 404)


def build_server(host: str, port: int) -> ThreadingHTTPServer:
    config = EventConfig(DATA_DIR)
    store = ExcelStore(WORKBOOK)
    store.ensure()
    event_config = config.config()
    Handler.service = EventService(store, config.config, config.guides)
    Handler.sessions = SessionStore(
        int((event_config.get("admin") or {}).get("session_minutes") or 720)
    )
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    return httpd


def main() -> int:
    try:  # keep the banner visible when output is piped to a log file
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(description="Run the Christmas Thing event site.")
    parser.add_argument("--host", default="0.0.0.0", help="bind address (default: all interfaces)")
    parser.add_argument("--port", type=int, default=8000, help="port (default: 8000)")
    parser.add_argument("--open", action="store_true", help="open the site in your browser")
    args = parser.parse_args()

    try:
        httpd = build_server(args.host, args.port)
    except StoreError as exc:
        print(f"\n  ! {exc.message}\n")
        return 1
    except OSError as exc:
        print(f"\n  ! Could not start on port {args.port}: {exc}\n")
        return 1

    local = f"http://127.0.0.1:{args.port}"
    lan = lan_ip()
    print("\n  ✦ The Christmas Thing")
    print("  " + "─" * 46)
    print(f"  Site       {local}")
    if lan and args.host in ("0.0.0.0", ""):
        print(f"  On phone   http://{lan}:{args.port}")
    print(f"  Database   {WORKBOOK}")
    print("  Stop       Ctrl+C")
    print("  " + "─" * 46 + "\n")

    if args.open:
        webbrowser.open(local)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Closing the doors. Merry Christmas.\n")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
