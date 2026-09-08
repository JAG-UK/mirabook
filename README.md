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
`MIRABOOK_OLLAMA_MODEL` at a larger local model like `gemma2:27b`.

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
(e.g. RTX 5090), `gemma2:27b` is the one to beat:

```bash
ollama pull gemma2:27b
export MIRABOOK_OLLAMA_MODEL=gemma2:27b
# raise parallelism on a big GPU (and set OLLAMA_NUM_PARALLEL on the server)
export MIRABOOK_OLLAMA_CONCURRENCY=4
```

Measured on an RTX 5090 with `scripts/compare_models.py`, translating the same
two blocks:

| Model | Per block | Whole book | Notes |
| ----- | --------- | ---------- | ----- |
| `gemma2:27b` | 0.35 s | ~3 min | Fastest, and its reading aids are the most concise |
| `translategemma:27b` | 0.38 s | ~3 min | As quick, but see the caveat below |
| `gemma4:26b` | 2.18 s | ~16 min | Mixture-of-experts, and no faster for it |
| `gemma4:31b` | 6.23 s | ~45 min | Newest and by far the slowest |

Translation quality was close enough across all four to come down to taste, so
speed decides it — hence the default. Two things worth knowing.

Newer is not faster: the Gemma 4 models are 6× and 18× slower than a Gemma 2
of the same size, and the mixture-of-experts model is not quicker than the
dense one despite activating a fraction of its weights. Fewer active
parameters means less arithmetic, not less waiting.

`translategemma` translates prose as well as anything here, but it answered
the "other translations" feature with whole-sentence translations rather than
alternatives for the highlighted phrase. If you use that feature, prefer a
general model.

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

## Serving it

`scripts/serve.sh` builds the frontend and serves the whole app (SPA + API +
media) from the backend on one port:

```bash
./scripts/serve.sh
```

It binds to `127.0.0.1`, so nothing outside the machine can reach it. To read
on another device, forward the port over SSH and open `http://localhost:8000`
there:

```bash
ssh -N -L 8000:localhost:8000 you@your-server
```

That keeps the exposed service OpenSSH rather than an application with one
shared password, and it needs no code.

### Putting it on the open internet

```bash
export MIRABOOK_BASIC_AUTH=reader:your-strong-password
PUBLIC=1 ./scripts/serve.sh        # prints an https://….trycloudflare.com URL
```

`PUBLIC=1` opens a Cloudflare quick tunnel. It is opt-in because a tunnel
reaches the app over loopback from the same machine, so opening one undoes the
loopback bind completely.

The backend has no accounts — `MIRABOOK_BASIC_AUTH` is one shared password
checked on every route, with no rate limiting behind it. For anything more than
a household, front it with Cloudflare Access or your own reverse proxy. Treat
the quick-tunnel URL as public: it changes on every restart, which is churn
rather than secrecy.

`HOST=0.0.0.0` exposes it on the LAN without a tunnel. For single-origin
serving under your own reverse proxy, set `MIRABOOK_STATIC_DIR=../frontend/dist`
and run uvicorn yourself.
