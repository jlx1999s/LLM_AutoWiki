type StoreData = Record<string, unknown>
import { invoke } from "@tauri-apps/api/core"

interface StoreLike {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

function storageKey(name: string): string {
  return `tauri-store:${name}`
}

function backendStorePath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_")
  return `data/.browser-store/${safe}`
}

function readStore(name: string): StoreData {
  const raw = window.localStorage.getItem(storageKey(name))
  if (!raw) return {}
  try {
    return JSON.parse(raw) as StoreData
  } catch {
    return {}
  }
}

function writeStore(name: string, data: StoreData): void {
  window.localStorage.setItem(storageKey(name), JSON.stringify(data))
}

async function readBackendStore(name: string): Promise<StoreData> {
  try {
    const raw = await invoke<string>("read_file", { path: backendStorePath(name) })
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed as StoreData
  } catch {
    return {}
  }
}

async function writeBackendStore(name: string, data: StoreData): Promise<void> {
  try {
    await invoke<void>("write_file", {
      path: backendStorePath(name),
      contents: JSON.stringify(data),
    })
  } catch {
    // ignore backend persistence errors; localStorage remains fallback
  }
}

export async function load(
  name: string,
  _options?: { autoSave?: boolean },
): Promise<StoreLike> {
  let hydrated = false
  let cache: StoreData = {}

  async function ensureHydrated(): Promise<void> {
    if (hydrated) return
    const local = readStore(name)
    const backend = await readBackendStore(name)
    cache = { ...backend, ...local }
    writeStore(name, cache)
    await writeBackendStore(name, cache)
    hydrated = true
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      await ensureHydrated()
      return cache[key] as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      await ensureHydrated()
      cache[key] = value
      writeStore(name, cache)
      await writeBackendStore(name, cache)
    },
    async delete(key: string): Promise<void> {
      await ensureHydrated()
      delete cache[key]
      writeStore(name, cache)
      await writeBackendStore(name, cache)
    },
  }
}
