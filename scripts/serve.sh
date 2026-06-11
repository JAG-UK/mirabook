#!/usr/bin/env bash
#
# One-shot: build the frontend, serve the whole app (SPA + API + media) from the
# backend on a single port, and expose it on the internet via a Cloudflare quick
# tunnel. Intended for your GPU server with Ollama already running.
#
#   ./scripts/serve.sh
#
# Useful env vars:
#   PORT                     port to serve on (default 8000)
#   MIRABOOK_OLLAMA_MODEL    model to use (default gemma2:27b)
#   MIRABOOK_OLLAMA_HOST     Ollama URL (default http://localhost:11434)
#   MIRABOOK_BASIC_AUTH      "user:pass" — STRONGLY recommended for a public URL
#   SKIP_BUILD=1             reuse an existing frontend/dist
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8000}"
export MIRABOOK_OLLAMA_MODEL="${MIRABOOK_OLLAMA_MODEL:-gemma2:27b}"
export MIRABOOK_OLLAMA_HOST="${MIRABOOK_OLLAMA_HOST:-http://localhost:11434}"
export MIRABOOK_STATIC_DIR="$ROOT/frontend/dist"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }

# --- preflight ---
command -v uv >/dev/null || { echo "uv not found — install from https://docs.astral.sh/uv/"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm not found"; exit 1; }

if ! curl -sf "$MIRABOOK_OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
  warn "WARNING: Ollama not reachable at $MIRABOOK_OLLAMA_HOST — start it first (ollama serve)."
else
  if ! curl -sf "$MIRABOOK_OLLAMA_HOST/api/tags" | grep -q "\"$MIRABOOK_OLLAMA_MODEL\""; then
    warn "Model '$MIRABOOK_OLLAMA_MODEL' not found in Ollama — pull it: ollama pull $MIRABOOK_OLLAMA_MODEL"
  fi
fi

if [ -z "${MIRABOOK_BASIC_AUTH:-}" ]; then
  warn "WARNING: MIRABOOK_BASIC_AUTH is not set — the public URL will have NO authentication."
  warn "         Anyone with the link can read, upload PDFs, and use your GPU. Set e.g.:"
  warn "         export MIRABOOK_BASIC_AUTH=reader:your-strong-password"
fi

# --- build frontend ---
if [ -z "${SKIP_BUILD:-}" ]; then
  bold "Building frontend…"
  ( cd "$ROOT/frontend" && pnpm install --silent && pnpm build )
fi

# --- start backend (serves SPA + API + media) ---
bold "Starting backend on :$PORT (app + API)…"
( cd "$ROOT/backend" && uv run uvicorn app.main:app --host 0.0.0.0 --port "$PORT" ) &
BACK=$!

cleanup() { kill "$BACK" 2>/dev/null || true; [ -n "${TUN:-}" ] && kill "$TUN" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

until curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; do sleep 1; done
bold "Backend up at http://localhost:$PORT"

# --- expose on the internet ---
if command -v cloudflared >/dev/null; then
  bold "Opening a public Cloudflare tunnel (Ctrl-C to stop everything)…"
  cloudflared tunnel --url "http://localhost:$PORT"
else
  warn "cloudflared not installed — no public URL created."
  echo "Install it for an instant https link:"
  echo "  macOS:  brew install cloudflared"
  echo "  Linux:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  echo "Then re-run, or expose port $PORT with your own tunnel / reverse proxy."
  echo "The app is reachable on your LAN at http://0.0.0.0:$PORT"
  wait "$BACK"
fi
