#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  LocalTube — run.sh
#  Detects Node.js / Python / PHP and starts the server on port 8080
# ────────────────────────────────────────────────────────────────────────────

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8080
URL="http://localhost:$PORT"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLD='\033[1m'
RST='\033[0m'

echo ""
echo -e "  ${RED}▶${RST}  ${BLD}LocalTube${RST} — Local Video Browser"
echo -e "  ─────────────────────────────────────"

# ── Check port availability ─────────────────────────────────────────────────
if lsof -Pi ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo -e "  ${YLW}⚠  Port $PORT is already in use.${RST}"
  echo -e "     Trying to open ${URL} anyway..."
  open_browser "$URL" 2>/dev/null || true
  exit 0
fi

# ── Open browser helper ─────────────────────────────────────────────────────
open_browser() {
  local url="$1"
  sleep 1.2
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" &>/dev/null &
  elif command -v open &>/dev/null; then
    open "$url"
  elif command -v start &>/dev/null; then
    start "$url"
  fi
}

# ── Node.js ─────────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  VER=$(node --version 2>/dev/null)
  echo -e "  ${GRN}✓${RST}  Using ${BLD}Node.js${RST} $VER"
  echo -e "  ${GRN}➜${RST}  ${URL}"
  echo ""
  open_browser "$URL" &
  exec node "$DIR/server.js"
  exit 0
fi

# ── Python 3 ────────────────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
  VER=$(python3 --version 2>/dev/null)
  echo -e "  ${GRN}✓${RST}  Using ${BLD}$VER${RST}"
  echo -e "  ${GRN}➜${RST}  ${URL}"
  echo ""
  open_browser "$URL" &
  exec python3 "$DIR/server.py"
  exit 0
fi

# ── Python 2 (fallback) ─────────────────────────────────────────────────────
if command -v python &>/dev/null; then
  VER=$(python --version 2>&1)
  echo -e "  ${YLW}⚠${RST}  Using ${BLD}$VER${RST} (limited support)"
  echo -e "  ${GRN}➜${RST}  ${URL}"
  echo ""
  open_browser "$URL" &
  exec python "$DIR/server.py"
  exit 0
fi

# ── PHP ─────────────────────────────────────────────────────────────────────
if command -v php &>/dev/null; then
  VER=$(php --version 2>/dev/null | head -1)
  echo -e "  ${GRN}✓${RST}  Using ${BLD}PHP${RST} (${VER})"
  echo -e "  ${GRN}➜${RST}  ${URL}"
  echo ""
  open_browser "$URL" &
  exec php -S "0.0.0.0:$PORT" "$DIR/server.php"
  exit 0
fi

# ── Nothing found ────────────────────────────────────────────────────────────
echo -e "  ${RED}✗  No supported runtime found!${RST}"
echo ""
echo "  Please install one of the following:"
echo "    • Node.js  → https://nodejs.org"
echo "    • Python 3 → https://python.org"
echo "    • PHP      → https://php.net"
echo ""
exit 1