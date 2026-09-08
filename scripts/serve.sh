#!/usr/bin/env bash
#
# One-shot: build the frontend, serve the whole app (SPA + API + media) from the
# backend on a single port, and expose it on the internet via a Cloudflare quick
# tunnel. Intended for your GPU server with Ollama already running.
#
#   ./scripts/serve.sh
#
# Useful env vars:
#   HOST                     interface to bind (default 127.0.0.1 — loopback
#                            only, so the app is reachable through an SSH
#                            tunnel but not from the network. Set 0.0.0.0 to
#                            expose it, and read the auth warning below first.)
#   PORT                     port to serve on (default 8000)
#   MIRABOOK_OLLAMA_MODEL    model to use (default gemma4:31b)
#   MIRABOOK_OLLAMA_HOST     Ollama URL (default http://localhost:11434)
#   MIRABOOK_BASIC_AUTH      "user:pass" — STRONGLY recommended for a public URL
#   SKIP_BUILD=1             reuse an existing frontend/dist
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
export MIRABOOK_OLLAMA_MODEL="${MIRABOOK_OLLAMA_MODEL:-gemma4:31b}"
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
( cd "$ROOT/backend" && uv run uvicorn app.main:app --host "$HOST" --port "$PORT" ) &
BACK=$!

cleanup() { kill "$BACK" 2>/dev/null || true; [ -n "${TUN:-}" ] && kill "$TUN" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Wait for the backend. Pass Basic-auth creds to the probe so it isn't rejected
# by the very auth we just enabled.
HEALTH_AUTH=()
[ -n "${MIRABOOK_BASIC_AUTH:-}" ] && HEALTH_AUTH=(-u "$MIRABOOK_BASIC_AUTH")
for _ in $(seq 1 60); do
  if curl -sf "${HEALTH_AUTH[@]}" "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  kill -0 "$BACK" 2>/dev/null || { echo "Backend process exited — see the log above."; exit 1; }
  sleep 1
done
if [ -z "${READY:-}" ]; then
  echo "Backend did not become healthy in time. If MIRABOOK_BASIC_AUTH is set,"
  echo "make sure it is exported in this shell (export MIRABOOK_BASIC_AUTH=user:pass)."
  exit 1
fi
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
  echo "Bound to $HOST:$PORT. On loopback, reach it with an SSH tunnel:"
  echo "  ssh -N -L $PORT:localhost:$PORT <this-machine>"
  wait "$BACK"
fi
