# LLM_AutoWiki

An implementation-oriented `LLM Wiki` project inspired by [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki), with a Python backend stack.

## Current Progress

- Design doc completed: `docs/LLM_WIKI_DESIGN_CN.md`
- Backend scaffold completed (`FastAPI + SQLite`)
- Upstream full frontend synced into `apps/web`
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
