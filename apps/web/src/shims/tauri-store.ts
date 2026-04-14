type StoreData = Record<string, unknown>

interface StoreLike {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

function storageKey(name: string): string {
  return `tauri-store:${name}`
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

export async function load(
  name: string,
  _options?: { autoSave?: boolean },
): Promise<StoreLike> {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const store = readStore(name)
      return store[key] as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      const store = readStore(name)
      store[key] = value
      writeStore(name, store)
    },
    async delete(key: string): Promise<void> {
      const store = readStore(name)
      delete store[key]
      writeStore(name, store)
    },
  }
}

