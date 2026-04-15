import type { LlmConfig } from "@/stores/wiki-store"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: () => void
  onError: (error: Error) => void
}

function backendApiBase(): string {
  const defaultBackend = `${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000`
  const env = (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env
  return env.VITE_BACKEND_URL || (window.location.port === "8000" ? window.location.origin : defaultBackend)
}

export async function streamChat(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks
  const apiBase = backendApiBase()
  const endpoint = (config.provider === "custom" || config.provider === "minimax")
    ? config.customEndpoint
    : config.provider === "ollama"
      ? config.ollamaUrl
      : ""
  try {
    const response = await fetch(`${apiBase}/api/llm/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: config.provider,
        api_key: config.apiKey,
        model: config.model,
        endpoint: endpoint || undefined,
        max_tokens: 4096,
        timeout_sec: 300,
        messages,
      }),
      signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = payload?.detail ? String(payload.detail) : `HTTP ${response.status}`
      onError(new Error(detail))
      return
    }
    const text = typeof payload?.text === "string" ? payload.text : ""
    if (text) onToken(text)
    onDone()
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || signal?.aborted)) {
      onDone()
      return
    }
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}
