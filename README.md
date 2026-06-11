# Mirabook

A language-learning reading aid. Upload a Spanish (or other target-language) PDF
e-book and read it with a high-quality AI translation rendered side-by-side, plus
reading aids: drag-select grammar/idiom explanations, multiple translation options,
and an anti-cheating blur on the translation.

The translation backend runs on **Ollama** by default (small models for local dev,
a large model on capable hardware), and can be switched to the Anthropic or OpenAI
API purely by configuration.

## Architecture

```
mirabook/
  backend/      FastAPI + PyMuPDF ingest + provider abstraction + SQLite cache
  frontend/     React + Vite + TypeScript + Tailwind reader
  sample-books/ public-domain Spanish PDF(s) for development
```

Each PDF is ingested into a normalized, **selectable** document model
(`Document → Page → Block`, blocks tagged heading/paragraph/list/image). Blocks
are translated one-by-one so a source paragraph and its translation share a stable
id — that alignment is what powers the blur reveal and source↔translation highlight.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (backend Python tooling; pins Python 3.12)
- Node 18+ and `pnpm`
- [Ollama](https://ollama.com/) running locally with a translation model, e.g.:
  ```
  ollama pull translategemma:4b
  ```

## Run the backend

```bash
cd backend
cp .env.example .env          # then edit if desired
uv run uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/api/health>

## Run the frontend

```bash
cd frontend
pnpm install
pnpm dev                      # http://localhost:5173
```

## Configuration

All settings are environment variables prefixed `MIRABOOK_` (see
`backend/.env.example`). Switch the high-quality path by setting
`MIRABOOK_PROVIDER=anthropic` (or `openai`) and the matching API key, or point
`MIRABOOK_OLLAMA_MODEL` at a larger local model like `gemma2:27b`.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/health` | provider/model status |
| GET  | `/api/books` | library list |
| POST | `/api/books` | upload + ingest a PDF |
| GET  | `/api/books/{id}` | metadata + TOC |
| GET  | `/api/books/{id}/pages/{n}` | source blocks + translations (cached) |
| POST | `/api/explain` | grammar/idiom explanation for a selection |
| POST | `/api/alternatives` | multiple translation options for a selection |
| POST | `/api/books/{id}/translate` | batch-translate pages (used by offline download) |

## Running on a GPU server

Ollama auto-detects the GPU (CUDA) — **no code changes are needed**. Just run
Ollama on the GPU box and point Mirabook at a strong general model that handles
both translation and the grammar/idiom/alternatives features. On a 32 GB card
(e.g. RTX 5090), `gemma2:27b` is a good pick and runs fully on the GPU:

```bash
ollama pull gemma2:27b
export MIRABOOK_OLLAMA_MODEL=gemma2:27b
# raise parallelism on a big GPU (and set OLLAMA_NUM_PARALLEL on the server)
export MIRABOOK_OLLAMA_CONCURRENCY=4
```

Switching models re-translates each page once (the cache is keyed per model).
`backend/scripts/reingest.py` and the in-app "Download for offline" flow are
handy ways to pre-translate whole books on the fast GPU.

## Serving over the internet

`scripts/serve.sh` builds the frontend, serves the whole app (SPA + API + media)
from the backend on one port, and opens a public **Cloudflare quick tunnel**:

```bash
# strongly recommended: protect the public URL
export MIRABOOK_BASIC_AUTH=reader:your-strong-password
./scripts/serve.sh        # prints an https://….trycloudflare.com URL
```

The backend has no built-in accounts, so set `MIRABOOK_BASIC_AUTH` (HTTP Basic on
every route) before exposing it publicly, or front it with Cloudflare Access /
your own reverse proxy. For single-origin serving without a tunnel, set
`MIRABOOK_STATIC_DIR=../frontend/dist` and run uvicorn yourself.
