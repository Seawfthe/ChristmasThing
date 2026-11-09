#!/usr/bin/env bash
# Start the Christmas Thing site with its own Python environment.
# First run creates .venv and installs openpyxl; later runs just start.
set -euo pipefail
cd "$(dirname "$0")"

# Some machines have a global pip config with `user = true`, which breaks
# installs inside a virtualenv. Force virtualenv installs.
export PIP_USER=0
export PIP_DISABLE_PIP_VERSION_CHECK=1

if [ ! -x ".venv/bin/python" ]; then
  echo "✦ Setting up a local Python environment (one time, needs internet)..."
  python3 -m venv .venv
  ./.venv/bin/python -m pip install --quiet --upgrade pip || true
  ./.venv/bin/python -m pip install --quiet -r requirements.txt
fi

exec ./.venv/bin/python server.py "$@"
