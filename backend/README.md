# Binary Thinking Wiki Backend

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) for the built-in demo UI.

## APIs

- `GET /healthz`
- `POST /api/ingest`
- `POST /api/wiki/build`
- `GET /api/wiki/pages`
- `GET /api/wiki/pages/{slug}`
- `POST /api/qa/query`
- `POST /api/eval/run`
- `GET /api/eval/latest`
- `POST /api/bridge/invoke`
- `GET /api/bridge/file?path=...`
- `POST /api/llm/chat`
- `POST /api/search/tavily`

## Notes

- Current version supports `.md` and `.txt` ingestion.
- QA supports retrieval strategies: `lexical`, `vector`, `hybrid`.
- Eval supports `jsonl` datasets and outputs:
  - `data/eval/runs/<run_id>/metrics.json`
  - `data/eval/runs/<run_id>/eval_report.md`
- Default eval dataset path: `../data/eval/qa_eval.jsonl`
- `POST /api/qa/query` request example:

```json
{
  "question": "二进制思考 Wiki 是什么？",
  "top_k": 5,
  "strategy": "hybrid"
}
```

- `POST /api/eval/run` request example:

```json
{
  "strategy": "hybrid",
  "top_k": 5
}
```
- Wiki output will be generated under `../data/wiki`.

## Security & Runtime Config

Environment variables (all optional):

- `LLM_WIKI_CORS_ALLOW_ORIGINS`
  - Comma-separated origins, default only local dev origins (`127.0.0.1/localhost` on common ports).
- `LLM_WIKI_ALLOW_UNSAFE_BRIDGE_PATHS`
  - Default `false`. Keep disabled for normal use.
- `LLM_WIKI_BRIDGE_EXTRA_ROOTS`
  - Extra comma-separated safe roots for bridge file access.
- `LLM_WIKI_QA_CANDIDATE_LIMIT`
  - Candidate pool size for QA prefiltering.
- `LLM_WIKI_LLM_PROXY_TIMEOUT_SEC`
  - Default timeout for backend LLM proxy calls.

## Database Migrations

- Migration scripts are in `backend/alembic/versions`.
- Startup automatically runs `alembic upgrade head`.
