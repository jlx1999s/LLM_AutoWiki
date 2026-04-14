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

interface ProjectOption {
  name: string
  path: string
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

function readRecentProjectPaths(): string[] {
  try {
    const raw = window.localStorage.getItem("tauri-store:app-state.json")
    if (!raw) return []
    const parsed = JSON.parse(raw) as { recentProjects?: Array<{ path?: string }> }
    return (parsed.recentProjects ?? [])
      .map((p) => p.path?.trim() ?? "")
      .filter(Boolean)
  } catch {
    return []
  }
}

async function chooseDirectoryPath(title: string, base: string): Promise<string | null> {
  const recent = readRecentProjectPaths()
  let discovered: ProjectOption[] = []
  try {
    discovered = await invokeBridge<ProjectOption[]>("list_projects", {
      base: base || undefined,
      max_depth: 4,
      limit: 30,
    })
  } catch {
    discovered = []
  }

  const candidates: string[] = []
  const seen = new Set<string>()
  const pushCandidate = (p: string) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    candidates.push(p)
  }
  if (base) pushCandidate(base)
  for (const p of recent) pushCandidate(p)
  for (const item of discovered) pushCandidate(item.path)

  const lines = [
    `${title}`,
    "选择方式：输入编号（推荐）或直接输入路径",
    "0) 手动输入路径",
  ]
  candidates.forEach((p, i) => {
    lines.push(`${i + 1}) ${p}`)
  })
  const raw = window.prompt(lines.join("\n"))
  if (!raw) return null

  const input = raw.trim()
  const idx = Number(input)
  if (Number.isInteger(idx) && idx >= 1 && idx <= candidates.length) {
    return candidates[idx - 1]
  }
  if (input === "0") {
    const manual = window.prompt("请输入路径（支持相对路径）")
    return manual?.trim() || null
  }
  return input
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

  let inputs: string[] = []
  if (options.directory && !options.multiple) {
    const picked = await chooseDirectoryPath(options.title ?? "Select Project Directory", base || "")
    if (!picked) return null
    inputs = [picked]
  } else {
    const hint = options.directory
      ? "输入目录路径（支持相对路径）"
      : "输入文件路径（支持相对路径）"
    const multiHint = options.multiple ? "（多个路径请用逗号分隔）" : ""
    const raw = window.prompt(
      `${options.title ?? "Select Path"}\n${hint}${multiHint}\n基准目录: ${base || "(默认)"}`
    )
    if (!raw) return null
    inputs = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
  }

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
