from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_healthz() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_ingest_build_and_qa(tmp_path: Path) -> None:
    sample_file = tmp_path / "sample.md"
    sample_file.write_text("# LLM\nLLM Wiki can compile documents into pages.", encoding="utf-8")

    with TestClient(app) as client:
        ingest_resp = client.post("/api/ingest", json={"path": str(sample_file), "recursive": False})
        assert ingest_resp.status_code == 200
        ingest_payload = ingest_resp.json()
        assert ingest_payload["ingested_count"] + ingest_payload["skipped_count"] >= 1

        build_resp = client.post("/api/wiki/build")
        assert build_resp.status_code == 200
        assert build_resp.json()["pages_generated"] >= 1

        qa_resp = client.post(
            "/api/qa/query",
            json={"question": "LLM Wiki 做什么？", "top_k": 3, "strategy": "hybrid"},
        )
        assert qa_resp.status_code == 200
        qa_payload = qa_resp.json()
        assert "answer" in qa_payload
        assert qa_payload["strategy"] == "hybrid"


def test_eval_run_and_latest(tmp_path: Path) -> None:
    sample_file = tmp_path / "eval_sample.md"
    sample_file.write_text(
        "# Wiki Evidence\nThe system compiles documents and returns citation evidence.",
        encoding="utf-8",
    )
    dataset = tmp_path / "qa_eval.jsonl"
    dataset.write_text(
        '{"question":"系统能做什么？","expected_keywords":["compile","documents"],"min_citations":1}\n',
        encoding="utf-8",
    )

    with TestClient(app) as client:
        ingest_resp = client.post("/api/ingest", json={"path": str(sample_file), "recursive": False})
        assert ingest_resp.status_code == 200

        build_resp = client.post("/api/wiki/build")
        assert build_resp.status_code == 200

        eval_resp = client.post(
            "/api/eval/run",
            json={"dataset_path": str(dataset), "strategy": "hybrid", "top_k": 3},
        )
        assert eval_resp.status_code == 200
        payload = eval_resp.json()
        assert payload["total_cases"] == 1
        assert "metrics_path" in payload
        assert "report_path" in payload

        latest_resp = client.get("/api/eval/latest")
        assert latest_resp.status_code == 200
        latest_payload = latest_resp.json()
        assert latest_payload["exists"] is True
        assert latest_payload["run_id"] == payload["run_id"]
