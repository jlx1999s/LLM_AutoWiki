import { describe, expect, it } from "vitest"

import { getProviderConfig } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"

const makeConfig = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: "minimax",
  apiKey: "test-key",
  model: "MiniMax-M2.7",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  ...overrides,
})

describe("llm-providers minimax", () => {
  it("uses official Anthropic-compatible endpoint by default", () => {
    const cfg = getProviderConfig(makeConfig())
    expect(cfg.url).toBe("https://api.minimaxi.com/anthropic/v1/messages")
  })

  it("supports custom minimax base endpoint", () => {
    const cfg = getProviderConfig(makeConfig({ customEndpoint: "https://api.minimax.io/anthropic" }))
    expect(cfg.url).toBe("https://api.minimax.io/anthropic/v1/messages")
  })

  it("adds both x-api-key and Authorization headers", () => {
    const cfg = getProviderConfig(makeConfig({ apiKey: " my-key " }))
    expect(cfg.headers["x-api-key"]).toBe("my-key")
    expect(cfg.headers.Authorization).toBe("Bearer my-key")
  })

  it("builds anthropic-style request body", () => {
    const cfg = getProviderConfig(makeConfig())
    const body = cfg.buildBody([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]) as Record<string, unknown>
    expect(body.model).toBe("MiniMax-M2.7")
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(4096)
    expect(body.system).toBe("You are helpful.")
    expect(body.messages).toEqual([{ role: "user", content: "Hello" }])
  })
})
