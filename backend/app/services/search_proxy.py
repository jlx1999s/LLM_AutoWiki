from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def tavily_search(api_key: str, query: str, max_results: int = 10, timeout_sec: int = 60) -> list[dict[str, str]]:
    key = api_key.strip()
    if not key:
        raise ValueError("Tavily API key is required")
    q = query.strip()
    if not q:
        raise ValueError("Query is required")

    payload = {
        "api_key": key,
        "query": q,
        "max_results": max_results,
        "search_depth": "advanced",
        "include_answer": False,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url="https://api.tavily.com/search",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Tavily upstream HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Tavily upstream network error: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except Exception as exc:
        raise RuntimeError(f"Tavily upstream returned invalid JSON: {raw[:400]}") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("Tavily upstream returned invalid payload")

    results = parsed.get("results")
    if not isinstance(results, list):
        return []

    output: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        source = ""
        if url:
            try:
                from urllib.parse import urlparse

                source = (urlparse(url).hostname or "").replace("www.", "")
            except Exception:
                source = ""
        output.append(
            {
                "title": str(item.get("title") or "Untitled"),
                "url": url,
                "snippet": str(item.get("content") or ""),
                "source": source,
            }
        )
    return output
