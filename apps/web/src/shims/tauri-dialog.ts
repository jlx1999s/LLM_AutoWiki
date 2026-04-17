import { isVirtualFilePath, registerPickedFiles } from "@/shims/browser-file-registry"

interface OpenOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
  filters?: Array<{ name?: string; extensions?: string[] }>
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

function pickFilesFromBrowser(options: OpenOptions): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = !!options.multiple
    input.tabIndex = -1
    input.style.position = "fixed"
    input.style.left = "-9999px"
    input.style.width = "1px"
    input.style.height = "1px"
    input.style.opacity = "0"

    if (options.filters?.length) {
      const exts = options.filters
        .flatMap((f) => f.extensions ?? [])
        .filter((ext) => ext && ext !== "*")
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
      if (exts.length) {
        input.accept = Array.from(new Set(exts)).join(",")
      }
    }

    let settled = false
    let focusFallbackTimer: number | null = null

    const finalize = (files: File[] | null) => {
      if (settled) return
      settled = true
      if (focusFallbackTimer !== null) {
        window.clearTimeout(focusFallbackTimer)
      }
      window.removeEventListener("focus", onWindowFocus, true)
      input.removeEventListener("change", onChange)
      input.removeEventListener("cancel", onCancel as EventListener)
      if (input.parentElement) {
        input.parentElement.removeChild(input)
      }
      resolve(files)
    }

    const onChange = () => {
      const files = Array.from(input.files ?? [])
      finalize(files.length > 0 ? files : null)
    }

    const onCancel = () => finalize(null)

    // Some environments do not fire "cancel" reliably.
    // When native picker closes and window refocuses, resolve if no selection came back.
    const onWindowFocus = () => {
      if (settled) return
      focusFallbackTimer = window.setTimeout(() => {
        const files = Array.from(input.files ?? [])
        finalize(files.length > 0 ? files : null)
      }, 350)
    }

    input.addEventListener("change", onChange, { once: true })
    input.addEventListener("cancel", onCancel as EventListener, { once: true })
    window.addEventListener("focus", onWindowFocus, true)
    document.body.appendChild(input)

    window.setTimeout(() => {
      input.click()
    }, 0)
  })
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
    // File import flow: use browser picker with robust cancel/focus fallback.
    const picked = await pickFilesFromBrowser(options)
    if (!picked) return null
    inputs = registerPickedFiles(picked)
  }

  if (inputs.length === 0) return null

  const resolved: string[] = []
  for (const input of inputs) {
    if (isVirtualFilePath(input)) {
      resolved.push(input)
      continue
    }
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

  const firstResolved = resolved[0]
  const nextBase = firstResolved && !isVirtualFilePath(firstResolved)
    ? (options.directory ? firstResolved : parentDir(firstResolved))
    : base
  if (nextBase) {
    window.localStorage.setItem(LAST_BASE_KEY, nextBase)
  }
  return options.multiple ? resolved : resolved[0]
}
