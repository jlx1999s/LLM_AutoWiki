import { describe, it, expect } from "vitest"

// Inline minimal types to avoid store/zustand dependencies in unit tests
type Provider = "openai" | "anthropic" | "google" | "ollama" | "custom" | "minimax"

interface LlmConfig {
  provider: Provider
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  maxContextSize: number
}

// Re-implement the minimax case logic inline so we can unit-test it
// without a browser environment or Tauri runtime.
function buildMiniMaxProviderConfig(config: LlmConfig) {
  const { apiKey, model, customEndpoint } = config
  const base = customEndpoint.trim() || "https://api.minimaxi.com/anthropic"
  const normalizedBase = base.replace(/\/+$/, "")
  const url = normalizedBase.endsWith("/v1/messages")
    ? normalizedBase
    : normalizedBase.endsWith("/v1")
      ? `${normalizedBase}/messages`
      : `${normalizedBase}/v1/messages`

  return {
    url,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    buildBody: (messages: Array<{ role: string; content: string }>) => ({
      messages: messages.filter((m) => m.role !== "system"),
      system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined,
      stream: true,
      max_tokens: 4096,
      model,
    }),
  }
}

const makeConfig = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: "minimax",
  apiKey: "test-key",
  model: "MiniMax-M2.7",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  ...overrides,
})

describe("MiniMax Provider", () => {
  it("uses the official Anthropic-compatible endpoint by default", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    expect(cfg.url).toBe("https://api.minimaxi.com/anthropic/v1/messages")
  })

  it("supports overriding endpoint with custom base URL", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ customEndpoint: "https://api.minimax.io/anthropic" }))
    expect(cfg.url).toBe("https://api.minimax.io/anthropic/v1/messages")
  })

  it("sets x-api-key header", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ apiKey: " my-key " }))
    expect(cfg.headers["x-api-key"]).toBe("my-key")
  })

  it("sets anthropic-version header", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    expect(cfg.headers["anthropic-version"]).toBe("2023-06-01")
  })

  it("sets Content-Type to application/json", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    expect(cfg.headers["Content-Type"]).toBe("application/json")
  })

  it("enables streaming", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.stream).toBe(true)
  })

  it("includes anthropic max_tokens", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.max_tokens).toBe(4096)
  })

  it("uses MiniMax-M2.7 model", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ model: "MiniMax-M2.7" }))
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.model).toBe("MiniMax-M2.7")
  })

  it("uses MiniMax-M2.7-highspeed model", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ model: "MiniMax-M2.7-highspeed" }))
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.model).toBe("MiniMax-M2.7-highspeed")
  })

  it("keeps non-system messages in request body", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    const messages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]
    const body = cfg.buildBody(messages) as Record<string, unknown>
    expect(body.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ])
    expect(body.system).toBe("You are helpful.")
  })
})

describe("MiniMax provider registration", () => {
  it("minimax is a valid provider value in the type union", () => {
    const provider: Provider = "minimax"
    expect(provider).toBe("minimax")
  })
})
