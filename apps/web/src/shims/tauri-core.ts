type InvokeArgs = Record<string, unknown> | undefined

const DEFAULT_BACKEND = `${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000`
const API_BASE =
  (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env
    .VITE_BACKEND_URL ||
  (window.location.port === "8000" ? window.location.origin : DEFAULT_BACKEND)

export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  const response = await fetch(`${API_BASE}/api/bridge/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args: args ?? {} }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload?.detail ? String(payload.detail) : `HTTP ${response.status}`
    throw new Error(detail)
  }
  return payload.result as T
}

export function convertFileSrc(path: string): string {
  if (/^(https?:|data:|blob:)/i.test(path)) return path
  return `${API_BASE}/api/bridge/file?path=${encodeURIComponent(path)}`
}

