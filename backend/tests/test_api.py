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
