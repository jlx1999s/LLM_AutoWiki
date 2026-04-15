# LLM_AutoWiki

An implementation-oriented `LLM Wiki` project inspired by [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki), with a Python backend stack.

## Monorepo Layout

- `apps/web`: React + TypeScript frontend
- `backend`: FastAPI backend + SQLite + Alembic migrations
- `docs`: design and architecture notes
- `data`: runtime data (gitignored)

## Current Progress

- Design doc completed: `docs/LLM_WIKI_DESIGN_CN.md`
- Backend scaffold completed (`FastAPI + SQLite`)
- Upstream full frontend synced into `apps/web`
- Added web bridge compatibility for upstream Tauri calls (`/api/bridge/*`)
- Core APIs available for:
  - ingest (`/api/ingest`)
  - wiki build (`/api/wiki/build`)
  - lexical QA (`/api/qa/query`)
  - eval run (`/api/eval/run`)

## Quick Start (Backend)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000) to use the demo UI.

## Quick Start (Frontend)

```bash
cd apps/web
npm ci
npm run dev
```

## Security Defaults

- Browser API keys are treated as session-only and are not persisted to disk.
- Browser calls to LLM providers and Tavily search are proxied via backend endpoints.
- Bridge file APIs are restricted to safe roots by default.
- CORS is restricted to local development origins by default.

To run in fully trusted local mode only:

```bash
export LLM_WIKI_ALLOW_UNSAFE_BRIDGE_PATHS=true
```
