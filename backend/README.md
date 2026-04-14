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
- `POST /api/eval/run`
- `GET /api/eval/latest`

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
  "question": "LLM Wiki 是什么？",
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
