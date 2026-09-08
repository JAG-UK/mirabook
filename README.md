# Mirabook

A language-learning reading aid. Upload a Spanish (or other target-language)
e-book — **PDF or EPUB** — and read it with a high-quality AI translation rendered
side-by-side, plus reading aids: drag-select grammar/idiom explanations, multiple
translation options, and an anti-cheating blur on the translation.

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

Each book is ingested into a normalized, **selectable** document model
(`Document → Page → Block`, blocks tagged heading/paragraph/list/image). Blocks
are translated one-by-one so a source paragraph and its translation share a stable
id — that alignment is what powers the blur reveal and source↔translation highlight.

Both fixed-layout (PDF) and reflowable (EPUB) sources go through the same
PyMuPDF-based ingest; reflowable books are paginated to a fixed A5 layout first,
so they get stable page numbers like a PDF does.

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
`MIRABOOK_OLLAMA_MODEL` at a larger local model like `gemma4:31b`.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/health` | provider/model status |
| GET  | `/api/books` | library list |
| GET  | `/api/shelves` | themed shelves and their book counts |
| POST | `/api/books` | upload + ingest a PDF or EPUB |
| GET  | `/api/books/{id}` | metadata + TOC |
| DELETE | `/api/books/{id}` | remove a book (rows + extracted media) |
| GET  | `/api/books/{id}/pages/{n}` | source blocks + translations (cached) |
| POST | `/api/explain` | grammar/idiom explanation for a selection |
| POST | `/api/alternatives` | multiple translation options for a selection |
| POST | `/api/books/{id}/translate` | batch-translate pages (used by offline download) |

## Filling the library from Project Gutenberg

Project Gutenberg carries 885 Spanish-language texts. `import_gutenberg.py`
brings in the ones worth reading:

```bash
cd backend
uv run python scripts/import_gutenberg.py --dry-run     # see what it would take
uv run python scripts/import_gutenberg.py --limit 20    # a first batch
uv run python scripts/import_gutenberg.py               # the rest
```

It reads Gutenberg's machine-readable catalogue, asks the local Ollama model to
judge each candidate for cultural value — the Spanish collection holds trade
catalogues and committee reports alongside Cervantes — then downloads the EPUB,
trims Gutenberg's licence boilerplate, and files the book on a themed shelf.

Two things worth knowing. **Downloads come from a mirror, not gutenberg.org**,
which blocks automated access and asks bulk users to go through a mirror with a
delay between requests; the default is a polite 2 s and `--delay` only goes
lower at your own risk. And **importing costs no GPU time** — translation is
on-demand and cached per block, so an unopened book is just rows in SQLite.

The run is resumable: books already imported are skipped by provenance, and the
model's verdicts are cached in `data/gutenberg-verdicts.json`, which is plain
JSON you can read and edit if you disagree with a call.

## Themed shelves

Books are filed on one of fourteen shelves (`app/shelves.py`), and the library
groups and filters by them. For Gutenberg books the shelf comes from Project
Gutenberg's own cataloguing — 96% of the Spanish collection carries a hand-made
"Category:" tag, and the rest have a Library of Congress class — so no guessing
is involved. Books you upload yourself arrive unshelved; to put them away:

```bash
uv run python scripts/categorize_library.py --dry-run
```

That asks the model to pick from the fixed shelf list, so the taxonomy stays
small enough to browse instead of sprawling into near-duplicates.

## Running on a GPU server

Ollama auto-detects the GPU (CUDA) — **no code changes are needed**. Just run
Ollama on the GPU box and point Mirabook at a strong general model that handles
both translation and the grammar/idiom/alternatives features. On a 32 GB card
(e.g. RTX 5090), the Gemma 4 medium models run fully on the GPU:

```bash
ollama pull gemma4:31b
export MIRABOOK_OLLAMA_MODEL=gemma4:31b
# raise parallelism on a big GPU (and set OLLAMA_NUM_PARALLEL on the server)
export MIRABOOK_OLLAMA_CONCURRENCY=4
```

| Model | VRAM | Notes |
| ----- | ---- | ----- |
| `gemma4:31b` | ~20 GB | Dense, best quality — the direct successor to `gemma2:27b` |
| `gemma4:26b` | ~19 GB | Mixture-of-experts (3.8B active): far faster per block, same footprint |
| `translategemma:27b` | ~17 GB | Purpose-built translator (55 languages); check the aids meet your bar |

`gemma4:26b` is worth trying first if you download whole books for offline
reading — only a fraction of its weights are active per token, so it translates
a book far faster than a dense model of the same size.

**Avoid reasoning models** (`qwen3`, `deepseek-r1`, `phi4-mini-reasoning`, …).
They think before answering, which is wasted on block translation and costs
two orders of magnitude in latency — measured on the sample page, `qwen3:4b`
took 98 s per block against 0.5 s for `translategemma:4b`.

Don't take any of this on trust — measure it on your own hardware:

```bash
cd backend
uv run python scripts/compare_models.py gemma2:27b gemma4:26b gemma4:31b \
    --blocks 4 --out compare.md
```

`scripts/compare_models.py` runs the same blocks through each model using
Mirabook's real prompts, warms each one up before timing it, and prints the
translations side by side along with a grammar/idiom check — so you can judge
quality as well as speed. It writes nothing to the database and leaves the
translation cache untouched. Run it on the box that will serve the app, while
it is otherwise idle.

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
