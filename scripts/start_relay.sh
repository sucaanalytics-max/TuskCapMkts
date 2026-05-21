#!/bin/bash
# start_relay.sh — Wrapper for mcx_relay.py called by launchd.
# Sources env vars, sets working dir, launches relay with 120s interval.
#
# After installing this repo, repoint ~/Library/LaunchAgents/com.mcx.relay.plist
# at this script path and reload via:
#   launchctl unload ~/Library/LaunchAgents/com.mcx.relay.plist
#   launchctl load   ~/Library/LaunchAgents/com.mcx.relay.plist

set -euo pipefail

PROJECT_ROOT="/Users/pranayagarwal/Dropbox/My Mac (Pranay's MacBook Air)/Documents/Working/exchange-pipeline"
ENV_FILE="$PROJECT_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: .env not found at $ENV_FILE" >&2
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

cd "$PROJECT_ROOT"
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting mcx_relay.py from $PROJECT_ROOT"

# Use system python3 if the homebrew 3.14 isn't installed at the expected path.
PY="/opt/homebrew/opt/python@3.14/Frameworks/Python.framework/Versions/3.14/bin/python3"
if [ ! -x "$PY" ]; then
    PY="$(command -v python3 || echo /usr/bin/python3)"
fi
exec "$PY" scripts/mcx_relay.py --interval 120
