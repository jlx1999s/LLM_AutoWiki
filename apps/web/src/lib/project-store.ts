import { load } from "@tauri-apps/plugin-store"
import type { WikiProject } from "@/types/wiki"
import type { LlmConfig, SearchApiConfig, EmbeddingConfig } from "@/stores/wiki-store"

const STORE_NAME = "app-state.json"
const RECENT_PROJECTS_KEY = "recentProjects"
const LAST_PROJECT_KEY = "lastProject"
const MAX_RECENT_PROJECTS = 10

async function getStore() {
  return load(STORE_NAME, { autoSave: true })
}

export async function getRecentProjects(): Promise<WikiProject[]> {
  const store = await getStore()
  const projects = await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)
  return projects ?? []
}

export async function getLastProject(): Promise<WikiProject | null> {
  const store = await getStore()
  const project = await store.get<WikiProject>(LAST_PROJECT_KEY)
  return project ?? null
}

export async function saveLastProject(project: WikiProject): Promise<void> {
  const store = await getStore()
  await store.set(LAST_PROJECT_KEY, project)
  await addToRecentProjects(project)
}

export async function addToRecentProjects(
  project: WikiProject
): Promise<void> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const filtered = existing.filter((p) => normalizeProjectPath(p.path) !== normalizeProjectPath(project.path))
  const updated = [project, ...filtered].slice(0, MAX_RECENT_PROJECTS)
  await store.set(RECENT_PROJECTS_KEY, updated)
}

const LLM_CONFIG_KEY = "llmConfig"

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const store = await getStore()
  await store.set(LLM_CONFIG_KEY, {
    ...config,
    apiKey: "",
  })
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  const store = await getStore()
  const cfg = (await store.get<LlmConfig>(LLM_CONFIG_KEY)) ?? null
  if (!cfg) return null
  if (cfg.apiKey) {
    await store.set(LLM_CONFIG_KEY, { ...cfg, apiKey: "" })
  }
  return { ...cfg, apiKey: "" }
}

const SEARCH_API_KEY = "searchApiConfig"

export async function saveSearchApiConfig(config: SearchApiConfig): Promise<void> {
  const store = await getStore()
  await store.set(SEARCH_API_KEY, {
    ...config,
    apiKey: "",
  })
}

export async function loadSearchApiConfig(): Promise<SearchApiConfig | null> {
  const store = await getStore()
  const cfg = (await store.get<SearchApiConfig>(SEARCH_API_KEY)) ?? null
  if (!cfg) return null
  if (cfg.apiKey) {
    await store.set(SEARCH_API_KEY, { ...cfg, apiKey: "" })
  }
  return { ...cfg, apiKey: "" }
}

const EMBEDDING_KEY = "embeddingConfig"

export async function saveEmbeddingConfig(config: EmbeddingConfig): Promise<void> {
  const store = await getStore()
  await store.set(EMBEDDING_KEY, {
    ...config,
    apiKey: "",
  })
}

export async function loadEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const store = await getStore()
  const cfg = (await store.get<EmbeddingConfig>(EMBEDDING_KEY)) ?? null
  if (!cfg) return null
  if (cfg.apiKey) {
    await store.set(EMBEDDING_KEY, { ...cfg, apiKey: "" })
  }
  return { ...cfg, apiKey: "" }
}

export async function removeFromRecentProjects(
  path: string
): Promise<void> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const target = normalizeProjectPath(path)
  const updated = existing.filter((p) => normalizeProjectPath(p.path) !== target)
  await store.set(RECENT_PROJECTS_KEY, updated)
}

function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.length <= 1) return normalized
  return normalized.replace(/\/+$/, "")
}

function hasSameOrder(a: WikiProject[], b: WikiProject[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (normalizeProjectPath(a[i].path) !== normalizeProjectPath(b[i].path)) {
      return false
    }
  }
  return true
}

export function mergeProjectLists(
  primary: WikiProject[],
  discovered: WikiProject[],
  limit = MAX_RECENT_PROJECTS
): WikiProject[] {
  const merged: WikiProject[] = []
  const seen = new Set<string>()
  const pushProject = (project: WikiProject) => {
    const key = normalizeProjectPath(project.path)
    if (!key || seen.has(key)) return
    seen.add(key)
    merged.push(project)
  }

  primary.forEach(pushProject)
  discovered.forEach(pushProject)
  return merged.slice(0, Math.max(1, limit))
}

export async function mergeRecentProjects(
  discovered: WikiProject[],
  limit = MAX_RECENT_PROJECTS
): Promise<WikiProject[]> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const merged = mergeProjectLists(existing, discovered, limit)
  if (!hasSameOrder(existing, merged)) {
    await store.set(RECENT_PROJECTS_KEY, merged)
  }
  return merged
}

const LANGUAGE_KEY = "language"

export async function saveLanguage(lang: string): Promise<void> {
  const store = await getStore()
  await store.set(LANGUAGE_KEY, lang)
}

export async function loadLanguage(): Promise<string | null> {
  const store = await getStore()
  return (await store.get<string>(LANGUAGE_KEY)) ?? null
}
