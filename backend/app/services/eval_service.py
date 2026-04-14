from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.qa_service import answer_question


@dataclass
class EvalCase:
    question: str
    expected_keywords: list[str]
    min_citations: int = 1


def _default_dataset_path() -> Path:
    settings = get_settings()
    return settings.data_dir / "eval" / "qa_eval.jsonl"


def _load_cases(dataset_path: Path) -> list[EvalCase]:
    cases: list[EvalCase] = []
    for line in dataset_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        question = str(obj.get("question", "")).strip()
        if not question:
            continue
        expected_keywords = [str(k).lower() for k in obj.get("expected_keywords", [])]
        min_citations = int(obj.get("min_citations", 1))
        cases.append(
            EvalCase(
                question=question,
                expected_keywords=expected_keywords,
                min_citations=min_citations,
            )
        )
    return cases


def _compute_answer_recall(answer: str, expected_keywords: list[str]) -> float:
    if not expected_keywords:
        return 1.0
    answer_lc = answer.lower()
    hit = sum(1 for kw in expected_keywords if kw and kw in answer_lc)
    return hit / len(expected_keywords)


def _safe_ratio(num: float, den: float) -> float:
    if den <= 0:
        return 0.0
    return num / den


def _write_eval_outputs(
    run_id: str,
    metrics: dict,
    case_rows: list[dict],
) -> tuple[Path, Path]:
    settings = get_settings()
    run_dir = settings.data_dir / "eval" / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    metrics_path = run_dir / "metrics.json"
    report_path = run_dir / "eval_report.md"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# Eval Report {run_id}",
        "",
        "## Metrics",
        "",
        f"- total_cases: {metrics['total_cases']}",
        f"- answered_cases: {metrics['answered_cases']}",
        f"- answer_recall: {metrics['answer_recall']:.4f}",
        f"- citation_coverage: {metrics['citation_coverage']:.4f}",
        f"- hallucination_rate: {metrics['hallucination_rate']:.4f}",
        f"- avg_latency_ms: {metrics['avg_latency_ms']:.2f}",
        "",
        "## Cases",
        "",
    ]
    for idx, row in enumerate(case_rows, start=1):
        lines.append(
            f"{idx}. q={row['question']} | recall={row['recall']:.4f} | citations={row['citation_count']} | latency_ms={row['latency_ms']}"
        )

    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    latest_metrics_path = settings.data_dir / "eval" / "latest_metrics.json"
    latest_report_path = settings.data_dir / "eval" / "latest_report.md"
    latest_run_path = settings.data_dir / "eval" / "latest_run_id.txt"
    latest_metrics_path.parent.mkdir(parents=True, exist_ok=True)
    latest_metrics_path.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    latest_report_path.write_text(report_path.read_text(encoding="utf-8"), encoding="utf-8")
    latest_run_path.write_text(run_id, encoding="utf-8")

    return metrics_path, report_path


def run_eval(
    db: Session,
    dataset_path: Optional[str] = None,
    top_k: int = 5,
    strategy: Literal["lexical", "vector", "hybrid"] = "hybrid",
) -> dict:
    path = Path(dataset_path).expanduser().resolve() if dataset_path else _default_dataset_path()
    if not path.exists():
        raise FileNotFoundError(f"Eval dataset not found: {path}")

    cases = _load_cases(path)
    if not cases:
        raise ValueError(f"Eval dataset has no valid cases: {path}")

    recalls: list[float] = []
    citation_hits = 0
    hallucinations = 0
    answered = 0
    latency_total = 0
    case_rows: list[dict] = []

    fallback_text = "当前知识库中没有足够证据来回答这个问题。"
    for case in cases:
        result = answer_question(db=db, question=case.question, top_k=top_k, strategy=strategy)
        answer = result["answer"]
        citations = result["citations"]
        latency_ms = int(result["latency_ms"])

        if citations:
            answered += 1
        if len(citations) >= case.min_citations:
            citation_hits += 1
        if not citations and answer.strip() != fallback_text:
            hallucinations += 1

        recall = _compute_answer_recall(answer=answer, expected_keywords=case.expected_keywords)
        recalls.append(recall)
        latency_total += latency_ms

        case_rows.append(
            {
                "question": case.question,
                "recall": recall,
                "citation_count": len(citations),
                "latency_ms": latency_ms,
            }
        )

    total = len(cases)
    metrics = {
        "run_id": datetime.utcnow().strftime("%Y%m%dT%H%M%SZ"),
        "total_cases": total,
        "answered_cases": answered,
        "answer_recall": _safe_ratio(sum(recalls), total),
        "citation_coverage": _safe_ratio(citation_hits, total),
        "hallucination_rate": _safe_ratio(hallucinations, total),
        "avg_latency_ms": _safe_ratio(latency_total, total),
        "strategy": strategy,
        "dataset_path": str(path),
    }
    metrics_path, report_path = _write_eval_outputs(
        run_id=metrics["run_id"], metrics=metrics, case_rows=case_rows
    )
    metrics["metrics_path"] = str(metrics_path)
    metrics["report_path"] = str(report_path)
    return metrics


def get_latest_eval() -> dict:
    settings = get_settings()
    latest_metrics_path = settings.data_dir / "eval" / "latest_metrics.json"
    latest_report_path = settings.data_dir / "eval" / "latest_report.md"
    latest_run_path = settings.data_dir / "eval" / "latest_run_id.txt"

    if not latest_metrics_path.exists():
        return {"exists": False}

    metrics = json.loads(latest_metrics_path.read_text(encoding="utf-8"))
    run_id = latest_run_path.read_text(encoding="utf-8").strip() if latest_run_path.exists() else None
    return {
        "exists": True,
        "run_id": run_id,
        "metrics_path": str(latest_metrics_path),
        "report_path": str(latest_report_path) if latest_report_path.exists() else None,
        "metrics": metrics,
    }

