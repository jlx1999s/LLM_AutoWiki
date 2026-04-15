from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Literal

Provider = Literal["openai", "anthropic", "google", "ollama", "custom", "minimax"]

DEFAULT_OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MINIMAX_BASE = "https://api.minimaxi.com/anthropic"
DEFAULT_GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_OLLAMA_URL = "http://localhost:11434/v1/chat/completions"


def _strip(url: str | None) -> str:
    return (url or "").strip().rstrip("/")


def _openai_url(endpoint: str | None) -> str:
    custom = _strip(endpoint)
    if not custom:
        return DEFAULT_OPENAI_URL
    if custom.endswith("/chat/completions"):
        return custom
    if custom.endswith("/v1"):
        return f"{custom}/chat/completions"
    return f"{custom}/v1/chat/completions"


def _anthropic_messages_url(endpoint: str | None, default_base: str) -> str:
    base = _strip(endpoint) or default_base
    if base.endswith("/v1/messages"):
        return base
    if base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def _google_generate_url(endpoint: str | None, model: str) -> str:
    base = _strip(endpoint) or DEFAULT_GOOGLE_BASE
    if ":generateContent" in base:
        return base
    if "/models/" in base:
        return f"{base}:generateContent"
    return f"{base}/models/{model}:generateContent"


def _normalize_messages(messages: list[dict[str, str]]) -> tuple[list[dict[str, str]], str]:
    system_parts = [m.get("content", "") for m in messages if m.get("role") == "system"]
    convo = [
        {"role": m.get("role", ""), "content": m.get("content", "")}
        for m in messages
        if m.get("role") in {"user", "assistant"}
    ]
    return convo, "\n".join(s for s in system_parts if s).strip()


def _request_json(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout_sec: int,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url=url, data=body, method="POST")
    for k, v in headers.items():
        if v:
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Upstream HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Upstream network error: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except Exception as exc:
        raise RuntimeError(f"Upstream returned invalid JSON: {raw[:400]}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Upstream returned invalid payload: {raw[:400]}")
    return parsed


def _extract_openai_text(parsed: dict[str, Any]) -> str:
    if parsed.get("error"):
        raise RuntimeError(str(parsed["error"]))
    choices = parsed.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError(f"OpenAI-compatible upstream returned no choices: {str(parsed)[:400]}")
    msg = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        texts = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
        if texts:
            return "\n".join(texts)
    raise RuntimeError("OpenAI-compatible upstream returned empty message content")


def _extract_anthropic_text(parsed: dict[str, Any]) -> str:
    if parsed.get("error"):
        err = parsed.get("error")
        if isinstance(err, dict):
            raise RuntimeError(str(err.get("message") or err))
        raise RuntimeError(str(err))
    content = parsed.get("content")
    if not isinstance(content, list):
        raise RuntimeError(f"Anthropic-compatible upstream returned no content: {str(parsed)[:400]}")
    texts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
    if texts:
        return "\n".join(texts)
    raise RuntimeError("Anthropic-compatible upstream returned empty text blocks")


def _extract_google_text(parsed: dict[str, Any]) -> str:
    if parsed.get("error"):
        err = parsed.get("error")
        if isinstance(err, dict):
            raise RuntimeError(str(err.get("message") or err))
        raise RuntimeError(str(err))
    candidates = parsed.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise RuntimeError(f"Google upstream returned no candidates: {str(parsed)[:400]}")
    first = candidates[0]
    if not isinstance(first, dict):
        raise RuntimeError("Google upstream candidate format invalid")
    content = first.get("content")
    if not isinstance(content, dict):
        raise RuntimeError("Google upstream content format invalid")
    parts = content.get("parts")
    if not isinstance(parts, list):
        raise RuntimeError("Google upstream parts format invalid")
    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
    if texts:
        return "\n".join(texts)
    raise RuntimeError("Google upstream returned empty text")


def run_chat_completion(
    provider: Provider,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    endpoint: str | None = None,
    max_tokens: int = 4096,
    timeout_sec: int = 300,
) -> str:
    provider = provider.strip()  # type: ignore[assignment]
    model = model.strip()
    if not model:
        raise ValueError("Model is required")
    if not messages:
        raise ValueError("Messages are required")

    convo, system_text = _normalize_messages(messages)

    if provider in {"openai", "custom", "ollama"}:
        url = _openai_url(endpoint if provider in {"openai", "custom"} else (_strip(endpoint) or DEFAULT_OLLAMA_URL))
        if provider == "ollama":
            url = _strip(endpoint) or DEFAULT_OLLAMA_URL
            if not url.endswith("/chat/completions"):
                if url.endswith("/v1"):
                    url = f"{url}/chat/completions"
                else:
                    url = f"{url}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if provider != "ollama":
            key = api_key.strip()
            if provider == "openai" and not key:
                raise ValueError("openai API key is required")
            if key:
                headers["Authorization"] = f"Bearer {key}"
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "stream": False}
        parsed = _request_json(url, headers, payload, timeout_sec)
        return _extract_openai_text(parsed)

    if provider in {"anthropic", "minimax"}:
        key = api_key.strip()
        if not key:
            raise ValueError(f"{provider} API key is required")
        default_base = DEFAULT_MINIMAX_BASE if provider == "minimax" else "https://api.anthropic.com"
        url = _anthropic_messages_url(endpoint, default_base)
        headers = {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        }
        if provider == "minimax":
            headers["Authorization"] = f"Bearer {key}"
        payload: dict[str, Any] = {
            "model": model,
            "messages": convo,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if system_text:
            payload["system"] = system_text
        parsed = _request_json(url, headers, payload, timeout_sec)
        return _extract_anthropic_text(parsed)

    if provider == "google":
        key = api_key.strip()
        if not key:
            raise ValueError("google API key is required")
        url = _google_generate_url(endpoint, model)
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
        }
        parts = [{"role": "model" if m.get("role") == "assistant" else "user", "parts": [{"text": m.get("content", "")}]} for m in convo]
        payload: dict[str, Any] = {"contents": parts}
        if system_text:
            payload["systemInstruction"] = {"parts": [{"text": system_text}]}
        parsed = _request_json(url, headers, payload, timeout_sec)
        return _extract_google_text(parsed)

    raise ValueError(f"Unsupported provider: {provider}")
