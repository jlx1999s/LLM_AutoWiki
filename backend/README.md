# LLM Wiki Backend

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

## APIs

- `GET /healthz`
- `POST /api/ingest`
- `POST /api/wiki/build`
- `GET /api/wiki/pages`
- `GET /api/wiki/pages/{slug}`
- `POST /api/qa/query`

## Notes

- Current version supports `.md` and `.txt` ingestion.
- QA supports retrieval strategies: `lexical`, `vector`, `hybrid`.
- `POST /api/qa/query` request example:

```json
{
  "question": "LLM Wiki 是什么？",
  "top_k": 5,
  "strategy": "hybrid"
}
```
- Wiki output will be generated under `../data/wiki`.
