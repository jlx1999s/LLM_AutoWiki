from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

DEFAULT_MINIMAX_BASE = "https://api.minimaxi.com/anthropic"


def _normalize_messages_url(base_or_url: str | None) -> str:
    base = (base_or_url or "").strip() or DEFAULT_MINIMAX_BASE
    base = base.rstrip("/")
    if base.endswith("/v1/messages"):
        return base
    if base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def _build_payload(
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
) -> dict[str, Any]:
    system_parts = [m.get("content", "") for m in messages if m.get("role") == "system"]
    conversation = [
        {"role": m.get("role"), "content": m.get("content", "")}
        for m in messages
        if m.get("role") in {"user", "assistant"}
    ]
    payload: dict[str, Any] = {
        "model": model,
        "messages": conversation,
        "max_tokens": max_tokens,
        "stream": False,
    }
    system_text = "\n".join(s for s in system_parts if s)
    if system_text:
        payload["system"] = system_text
    return payload


def run_minimax_completion(
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    endpoint: str | None = None,
    max_tokens: int = 4096,
    timeout_sec: int = 300,
) -> str:
    api_key = api_key.strip()
    model = model.strip()
    if not api_key:
        raise ValueError("MiniMax API key is required")
    if not model:
        raise ValueError("MiniMax model is required")
    if not messages:
        raise ValueError("MiniMax messages are required")

    url = _normalize_messages_url(endpoint)
    payload = _build_payload(model=model, messages=messages, max_tokens=max_tokens)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url=url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-api-key", api_key)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("anthropic-version", "2023-06-01")

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"MiniMax upstream HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"MiniMax upstream network error: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except Exception as exc:
        raise RuntimeError(f"MiniMax upstream returned invalid JSON: {raw[:400]}") from exc

    if isinstance(parsed, dict) and parsed.get("error"):
        err = parsed.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or err)
        else:
            msg = str(err)
        raise RuntimeError(f"MiniMax error: {msg}")

    content_blocks = parsed.get("content") if isinstance(parsed, dict) else None
    text_parts: list[str] = []
    if isinstance(content_blocks, list):
        for block in content_blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text:
                    text_parts.append(text)

    merged = "\n".join(text_parts).strip()
    if merged:
        return merged
    raise RuntimeError(f"MiniMax upstream returned empty content: {raw[:400]}")
