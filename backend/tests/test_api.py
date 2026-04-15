from pathlib import Path

from fastapi.testclient import TestClient

from app.api import llm as llm_api
from app.api import search as search_api
from app.main import app


def test_healthz() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_root_page() -> None:
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "二进制思考 Wiki Studio" in response.text


def test_ingest_build_and_qa(tmp_path: Path) -> None:
    sample_file = tmp_path / "sample.md"
    sample_file.write_text("# LLM\nBinary Thinking Wiki can compile documents into pages.", encoding="utf-8")

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
            json={"question": "二进制思考 Wiki 做什么？", "top_k": 3, "strategy": "hybrid"},
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


def test_bridge_invoke_file_ops(tmp_path: Path) -> None:
    base_dir = tmp_path / "demo_project"
    base_dir.mkdir(parents=True, exist_ok=True)
    target_file = base_dir / "notes.md"

    with TestClient(app) as client:
        write_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "write_file",
                "args": {"path": str(target_file), "contents": "# hello\nbridge write ok"},
            },
        )
        assert write_resp.status_code == 200

        read_resp = client.post(
            "/api/bridge/invoke",
            json={"command": "read_file", "args": {"path": str(target_file)}},
        )
        assert read_resp.status_code == 200
        assert "bridge write ok" in read_resp.json()["result"]

        list_resp = client.post(
            "/api/bridge/invoke",
            json={"command": "list_directory", "args": {"path": str(base_dir)}},
        )
        assert list_resp.status_code == 200
        nodes = list_resp.json()["result"]
        assert isinstance(nodes, list)
        assert any(node["name"] == "notes.md" for node in nodes)


def test_bridge_project_copy_vector_and_file_endpoint(tmp_path: Path) -> None:
    parent = tmp_path / "workspace"
    parent.mkdir(parents=True, exist_ok=True)
    source_dir = tmp_path / "source_dir"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_file = source_dir / "doc.txt"
    source_file.write_text("alpha beta gamma", encoding="utf-8")

    with TestClient(app) as client:
        create_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "create_project",
                "args": {"name": "demo", "path": str(parent)},
            },
        )
        assert create_resp.status_code == 200
        project = create_resp.json()["result"]
        assert project["name"] == "demo"
        assert project["path"].endswith("/demo")

        open_resp = client.post(
            "/api/bridge/invoke",
            json={"command": "open_project", "args": {"path": project["path"]}},
        )
        assert open_resp.status_code == 200

        copy_dir_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "copy_directory",
                "args": {
                    "source": str(source_dir),
                    "destination": f"{project['path']}/raw/sources/imported",
                },
            },
        )
        assert copy_dir_resp.status_code == 200
        copied = copy_dir_resp.json()["result"]
        assert len(copied) == 1
        assert copied[0].endswith("/raw/sources/imported/doc.txt")

        preprocess_resp = client.post(
            "/api/bridge/invoke",
            json={"command": "preprocess_file", "args": {"path": copied[0]}},
        )
        assert preprocess_resp.status_code == 200
        assert preprocess_resp.json()["result"].endswith("/.cache/doc.txt.txt")

        related_file = Path(project["path"]) / "wiki" / "sources" / "doc.md"
        related_file.parent.mkdir(parents=True, exist_ok=True)
        related_file.write_text('sources: ["doc.txt"]\n# doc', encoding="utf-8")
        related_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "find_related_wiki_pages",
                "args": {"projectPath": project["path"], "sourceName": "doc.txt"},
            },
        )
        assert related_resp.status_code == 200
        assert len(related_resp.json()["result"]) >= 1

        upsert_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "vector_upsert",
                "args": {
                    "projectPath": project["path"],
                    "pageId": "p1",
                    "embedding": [1.0, 0.0, 0.0],
                },
            },
        )
        assert upsert_resp.status_code == 200
        count_resp = client.post(
            "/api/bridge/invoke",
            json={"command": "vector_count", "args": {"projectPath": project["path"]}},
        )
        assert count_resp.status_code == 200
        assert count_resp.json()["result"] == 1

        search_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "vector_search",
                "args": {
                    "projectPath": project["path"],
                    "queryEmbedding": [1.0, 0.0, 0.0],
                    "topK": 3,
                },
            },
        )
        assert search_resp.status_code == 200
        assert search_resp.json()["result"][0]["page_id"] == "p1"

        delete_vec_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "vector_delete",
                "args": {"projectPath": project["path"], "pageId": "p1"},
            },
        )
        assert delete_vec_resp.status_code == 200

        file_get_resp = client.get(
            "/api/bridge/file",
            params={"path": str(source_file)},
        )
        assert file_get_resp.status_code == 200
        assert "alpha beta gamma" in file_get_resp.text


def test_bridge_resolve_path_supports_relative(tmp_path: Path) -> None:
    base = tmp_path / "base"
    base.mkdir(parents=True, exist_ok=True)
    file_path = base / "a.txt"
    file_path.write_text("ok", encoding="utf-8")

    with TestClient(app) as client:
        root_resp = client.post(
            "/api/bridge/invoke",
            json={"command": "project_root", "args": {}},
        )
        assert root_resp.status_code == 200
        assert isinstance(root_resp.json()["result"], str)

        resolve_resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "resolve_path",
                "args": {
                    "path": "a.txt",
                    "base": str(base),
                    "must_exist": True,
                },
            },
        )
        assert resolve_resp.status_code == 200
        assert resolve_resp.json()["result"].endswith("/a.txt")


def test_bridge_list_projects_discovers_workspace(tmp_path: Path) -> None:
    base = tmp_path / "workspace"
    project_dir = base / "mywiki"
    (project_dir / "wiki").mkdir(parents=True, exist_ok=True)
    (project_dir / "raw" / "sources").mkdir(parents=True, exist_ok=True)

    with TestClient(app) as client:
        resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "list_projects",
                "args": {"base": str(base), "max_depth": 2, "limit": 10},
            },
        )
        assert resp.status_code == 200
        rows = resp.json()["result"]
        assert any(r["name"] == "mywiki" for r in rows)


def test_bridge_write_file_base64(tmp_path: Path) -> None:
    out = tmp_path / "bin.dat"
    payload = "AAEC"  # bytes: 0x00 0x01 0x02

    with TestClient(app) as client:
        resp = client.post(
            "/api/bridge/invoke",
            json={
                "command": "write_file_base64",
                "args": {"path": str(out), "content_base64": payload},
            },
        )
        assert resp.status_code == 200
        assert out.read_bytes() == b"\x00\x01\x02"


def test_llm_minimax_proxy(monkeypatch) -> None:
    def fake_run_minimax_completion(**_: object) -> str:
        return "proxy ok"

    monkeypatch.setattr(llm_api, "run_minimax_completion", fake_run_minimax_completion)

    with TestClient(app) as client:
        resp = client.post(
            "/api/llm/minimax",
            json={
                "api_key": "k",
                "model": "MiniMax-M2.7",
                "messages": [{"role": "user", "content": "hello"}],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["text"] == "proxy ok"


def test_llm_chat_proxy(monkeypatch) -> None:
    def fake_chat(**_: object) -> str:
        return "chat ok"

    monkeypatch.setattr(llm_api, "run_chat_completion", fake_chat)

    with TestClient(app) as client:
        resp = client.post(
            "/api/llm/chat",
            json={
                "provider": "openai",
                "api_key": "k",
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": "hello"}],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["text"] == "chat ok"


def test_search_tavily_proxy(monkeypatch) -> None:
    def fake_search(**_: object) -> list[dict[str, str]]:
        return [
            {
                "title": "t",
                "url": "https://example.com",
                "snippet": "s",
                "source": "example.com",
            }
        ]

    monkeypatch.setattr(search_api, "tavily_search", fake_search)

    with TestClient(app) as client:
        resp = client.post(
            "/api/search/tavily",
            json={
                "api_key": "k",
                "query": "binary thinking",
                "max_results": 3,
            },
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["results"][0]["source"] == "example.com"


def test_bridge_denies_outside_safe_roots() -> None:
    with TestClient(app) as client:
        resp = client.post(
            "/api/bridge/invoke",
            json={"command": "read_file", "args": {"path": "/etc/hosts"}},
        )
        assert resp.status_code == 403
