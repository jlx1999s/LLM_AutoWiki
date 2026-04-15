import type { SearchApiConfig } from "@/stores/wiki-store"

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export async function webSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number = 10,
): Promise<WebSearchResult[]> {
  if (config.provider === "none" || !config.apiKey) {
    throw new Error("Web search not configured. Add a Tavily API key in Settings.")
  }

  switch (config.provider) {
    case "tavily":
      return tavilySearch(query, config.apiKey, maxResults)
    default:
      throw new Error(`Unknown search provider: ${config.provider}`)
  }
}

function backendApiBase(): string {
  const defaultBackend = `${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000`
  const env = (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env
  return env.VITE_BACKEND_URL || (window.location.port === "8000" ? window.location.origin : defaultBackend)
}

async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const response = await fetch(`${backendApiBase()}/api/search/tavily`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`Tavily search failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  return (data.results ?? []).map((r: { title: string; url: string; snippet: string; source: string }) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    snippet: r.snippet ?? "",
    source: r.source ?? "",
  }))
}
