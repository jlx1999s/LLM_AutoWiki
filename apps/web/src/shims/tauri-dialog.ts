interface OpenOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
}

const LAST_BASE_KEY = "bridge:lastOpenBase"

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx <= 0) return normalized
  return normalized.slice(0, idx)
}

async function invokeBridge<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const defaultBackend = `${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000`
  const apiBase =
    (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env
      .VITE_BACKEND_URL ||
    (window.location.port === "8000" ? window.location.origin : defaultBackend)

  const resp = await fetch(`${apiBase}/api/bridge/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload?.detail ? String(payload.detail) : `HTTP ${resp.status}`)
  }
  return payload.result as T
}

export async function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  let base = window.localStorage.getItem(LAST_BASE_KEY)
  if (!base) {
    try {
      base = await invokeBridge<string>("project_root")
    } catch {
      base = ""
    }
  }

  const hint = options.directory
    ? "输入目录路径（支持相对路径）"
    : "输入文件路径（支持相对路径）"
  const multiHint = options.multiple ? "（多个路径请用逗号分隔）" : ""
  const raw = window.prompt(
    `${options.title ?? "Select Path"}\n${hint}${multiHint}\n基准目录: ${base || "(默认)"}`
  )
  if (!raw) return null

  const inputs = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
  if (inputs.length === 0) return null

  const resolved: string[] = []
  for (const input of inputs) {
    try {
      const abs = await invokeBridge<string>("resolve_path", {
        path: input,
        base: base || undefined,
        must_exist: true,
      })
      resolved.push(abs)
    } catch (err) {
      window.alert(`路径不可用: ${input}\n${String(err)}`)
      return null
    }
  }

  const nextBase = options.directory ? resolved[0] : parentDir(resolved[0])
  if (nextBase) {
    window.localStorage.setItem(LAST_BASE_KEY, nextBase)
  }
  return options.multiple ? resolved : resolved[0]
}
