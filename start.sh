#!/usr/bin/env bash
# ──────────────────────────────────────────────
#  Slide Controller — One-command launcher
#  Usage:  ./start.sh
# ──────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
CLIENT_DIR="$SCRIPT_DIR/client"

echo ""
echo "═══════════════════════════════════════════════"
echo "  SLIDE CONTROLLER — STARTING"
echo "═══════════════════════════════════════════════"
echo ""

# ── 1. Check node is installed ──────────────────
if ! command -v node &>/dev/null; then
  echo "✘ Node.js is not installed. Install it first."
  exit 1
fi

# ── 2. Install server deps if needed ────────────
if [ ! -d "$SERVER_DIR/node_modules" ]; then
  echo "⟳ Installing server dependencies…"
  cd "$SERVER_DIR" && npm install --silent
  echo "✔ Server dependencies installed"
fi

# ── 3. Install & build client if needed ─────────
if [ ! -d "$CLIENT_DIR/node_modules" ]; then
  echo "⟳ Installing client dependencies…"
  cd "$CLIENT_DIR" && npm install --silent
  echo "✔ Client dependencies installed"
fi

if [ ! -f "$CLIENT_DIR/dist/index.html" ]; then
  echo "⟳ Building client…"
  cd "$CLIENT_DIR" && npm run build --silent
  echo "✔ Client built"
fi

# ── 4. Launch the server (preflight is built-in) ─
echo ""
cd "$SERVER_DIR"
exec node index.js
