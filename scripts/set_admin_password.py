#!/usr/bin/env python3
"""Change the admin panel password.

    python3 scripts/set_admin_password.py
    python3 scripts/set_admin_password.py --password "new-password" --no-build

Writes a fresh PBKDF2-SHA256 salt + hash into data/event.json and (by default)
rebuilds dist/index.html so the static site picks it up. The Python build reads
event.json on every request, so it needs no rebuild.

Never pass real passwords on a shared command line; the prompt hides input.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENT_JSON = ROOT / "data" / "event.json"
BUILD_SCRIPT = ROOT / "scripts" / "build_static.py"
ITERATIONS = 210_000
MIN_LENGTH = 8


def main() -> int:
    parser = argparse.ArgumentParser(description="Set the admin panel password.")
    parser.add_argument("--password", help="password (omit to be prompted securely)")
    parser.add_argument("--no-build", action="store_true", help="don't rebuild dist/index.html")
    parser.add_argument("--iterations", type=int, default=ITERATIONS, help="PBKDF2 rounds")
    args = parser.parse_args()

    if not EVENT_JSON.is_file():
        print(f"  ! {EVENT_JSON} not found — run this from the project root.")
        return 1

    password = args.password
    if password is None:
        password = getpass.getpass("  New admin password: ")
        confirm = getpass.getpass("  Again:            ")
        if password != confirm:
            print("  ! Passwords do not match.")
            return 1

    if len(password) < MIN_LENGTH:
        print(f"  ! Use at least {MIN_LENGTH} characters.")
        return 1

    config = json.loads(EVENT_JSON.read_text(encoding="utf-8"))
    salt = os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), args.iterations, dklen=32
    ).hex()

    admin = config.setdefault("admin", {})
    admin["password"] = {
        "algo": "pbkdf2-sha256",
        "iterations": args.iterations,
        "salt": salt,
        "hash": digest,
    }
    admin.setdefault("session_minutes", 720)
    EVENT_JSON.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("\n  ✦ Admin password updated")
    print("  " + "─" * 44)
    print(f"  Config   {EVENT_JSON.relative_to(ROOT)}")
    print(f"  Rounds   {args.iterations:,} (PBKDF2-SHA256)")
    print("  →        Python build picks it up immediately")

    if args.no_build:
        print("  →        Static build: run python3 scripts/build_static.py\n")
        return 0

    print("  →        Rebuilding dist/index.html…")
    result = subprocess.run([sys.executable, str(BUILD_SCRIPT)], cwd=ROOT)
    if result.returncode != 0:
        print("  ! Build failed; fix the error above and rerun the build.")
        return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
