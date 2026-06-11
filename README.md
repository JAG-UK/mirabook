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
