import { listDirectory, readFile, writeFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { getRelativePath, normalizePath } from "@/lib/path-utils"

export interface LinkRegistryEntry {
  path: string
  slug: string
  title: string
  aliases: string[]
}

export interface LinkRegistryData {
  generatedAt: string
  entries: LinkRegistryEntry[]
}

const REGISTRY_RELATIVE_PATH = ".llm-wiki/link-registry.json"

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function parseInlineAliasList(raw: string): string[] {
  const inside = raw.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!inside) return []
  return inside
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0)
}

function parseAliasBlock(content: string): string[] {
  const lines = content.split("\n")
  const aliases: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!/^aliases:\s*$/m.test(line)) continue

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]
      const listMatch = next.match(/^\s*-\s+(.+?)\s*$/)
      if (!listMatch) break
      aliases.push(listMatch[1].trim().replace(/^["']|["']$/g, ""))
    }
    break
  }

  return aliases
}

function extractTitleAndAliases(content: string, fallbackTitle: string): { title: string; aliases: string[] } {
  const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)
  const headingMatch = content.match(/^#\s+(.+?)\s*$/m)

  const inlineAliasesMatch = content.match(/^aliases:\s*(\[[^\]]*\])\s*$/m)
  const inlineAliases = inlineAliasesMatch ? parseInlineAliasList(inlineAliasesMatch[1]) : []
  const blockAliases = parseAliasBlock(content)

  const title = (titleMatch?.[1] ?? headingMatch?.[1] ?? fallbackTitle).trim()
  const aliases = Array.from(new Set([...inlineAliases, ...blockAliases].map((a) => a.trim()).filter(Boolean)))

  return { title, aliases }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const v = value.trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export function normalizeLinkKey(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

export function baseNameFromSlug(slug: string): string {
  const normalized = normalizeLinkKey(slug)
  const parts = normalized.split("/")
  return parts[parts.length - 1] ?? normalized
}

export async function rebuildLinkRegistry(projectPath: string): Promise<LinkRegistryData> {
  const pp = normalizePath(projectPath)
  const wikiRoot = `${pp}/wiki`

  let tree: FileNode[] = []
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    const empty: LinkRegistryData = { generatedAt: new Date().toISOString(), entries: [] }
    try {
      await writeFile(`${pp}/${REGISTRY_RELATIVE_PATH}`, JSON.stringify(empty, null, 2))
    } catch {
      // non-critical
    }
    return empty
  }

  const files = flattenMdFiles(tree)
  const entries: LinkRegistryEntry[] = []

  for (const file of files) {
    const relativePath = getRelativePath(file.path, wikiRoot)
    const slug = relativePath.replace(/\.md$/, "")
    const baseName = file.name.replace(/\.md$/, "")

    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      // ignore unreadable files
    }

    const { title, aliases } = extractTitleAndAliases(content, baseName)
    const combinedAliases = uniqueStrings([title, baseName, slug, ...aliases])

    entries.push({
      path: relativePath,
      slug,
      title,
      aliases: combinedAliases,
    })
  }

  const data: LinkRegistryData = {
    generatedAt: new Date().toISOString(),
    entries,
  }

  try {
    await writeFile(`${pp}/${REGISTRY_RELATIVE_PATH}`, JSON.stringify(data, null, 2))
  } catch {
    // non-critical
  }

  return data
}

export function buildLinkLookup(entries: LinkRegistryEntry[]): Map<string, LinkRegistryEntry> {
  const lookup = new Map<string, LinkRegistryEntry>()
  const conflicts = new Set<string>()

  for (const entry of entries) {
    const keys = uniqueStrings([
      entry.slug,
      entry.path,
      baseNameFromSlug(entry.slug),
      entry.title,
      ...entry.aliases,
    ])

    for (const rawKey of keys) {
      const key = normalizeLinkKey(rawKey)
      if (!key) continue
      const existing = lookup.get(key)
      if (!existing) {
        lookup.set(key, entry)
        continue
      }
      if (existing.slug !== entry.slug) {
        conflicts.add(key)
      }
    }
  }

  for (const conflict of conflicts) {
    lookup.delete(conflict)
  }

  return lookup
}
