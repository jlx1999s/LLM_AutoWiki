import { listDirectory, readFile, writeFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { getRelativePath, normalizePath } from "@/lib/path-utils"
import {
  baseNameFromSlug,
  buildLinkLookup,
  normalizeLinkKey,
  rebuildLinkRegistry,
} from "@/lib/link-registry"

const WIKILINK_REGEX = /\[\[([^\]|]+?)(\|[^\]]+)?\]\]/g

interface UnresolvedLink {
  target: string
  count: number
}

export interface AutoLinkRepairStats {
  filesTouched: number
  linksRewritten: number
  stubsCreated: number
  rewrittenFiles: string[]
  stubPaths: string[]
  unresolved: UnresolvedLink[]
}

export interface AutoLinkRepairOptions {
  createStubs?: boolean
  replaceUnresolvedWithText?: boolean
}

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

function shouldSkipPage(relativePath: string): boolean {
  return relativePath === "log.md" || relativePath === "index.md"
}

function canonicalTarget(
  slug: string,
  basenameCount: Map<string, number>,
): string {
  const basename = baseNameFromSlug(slug)
  return (basenameCount.get(basename) ?? 0) === 1 ? basename : slug
}

function normalizeWikilinkTarget(rawTarget: string): string {
  return rawTarget.split("#")[0].trim()
}

function shouldCreateStub(linkTarget: string): boolean {
  if (!linkTarget.trim()) return false
  if (linkTarget.includes("://")) return false
  if (linkTarget.includes("/")) return false
  if (linkTarget.length > 80) return false
  return true
}

function sanitizeStubFileName(linkTarget: string): string {
  const cleaned = linkTarget
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
  return cleaned || "untitled"
}

function escapeQuote(value: string): string {
  return value.replace(/"/g, '\\"')
}

export async function autoRepairWikiLinks(
  projectPath: string,
  sourceFileName: string,
  options: AutoLinkRepairOptions = {},
): Promise<AutoLinkRepairStats> {
  const pp = normalizePath(projectPath)
  const wikiRoot = `${pp}/wiki`
  const createStubs = options.createStubs ?? true
  const replaceUnresolvedWithText = options.replaceUnresolvedWithText ?? false

  const registry = await rebuildLinkRegistry(pp)
  const lookup = buildLinkLookup(registry.entries)

  const basenameCount = new Map<string, number>()
  for (const entry of registry.entries) {
    const basename = baseNameFromSlug(entry.slug)
    basenameCount.set(basename, (basenameCount.get(basename) ?? 0) + 1)
  }

  let tree: FileNode[] = []
  try {
    tree = await listDirectory(wikiRoot)
  } catch {
    return {
      filesTouched: 0,
      linksRewritten: 0,
      stubsCreated: 0,
      rewrittenFiles: [],
      stubPaths: [],
      unresolved: [],
    }
  }

  const files = flattenMdFiles(tree)
  const unresolvedCount = new Map<string, number>()
  const rewrittenFiles: string[] = []
  let filesTouched = 0
  let linksRewritten = 0

  for (const file of files) {
    const relativePath = getRelativePath(file.path, wikiRoot)
    if (shouldSkipPage(relativePath)) continue

    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      continue
    }

    let changed = false
    const updated = content.replace(WIKILINK_REGEX, (full, raw, displayPart) => {
      const rawTarget = normalizeWikilinkTarget(String(raw))
      const key = normalizeLinkKey(rawTarget)
      const entry = lookup.get(key)
      if (!entry) {
        unresolvedCount.set(rawTarget, (unresolvedCount.get(rawTarget) ?? 0) + 1)
        if (replaceUnresolvedWithText) {
          changed = true
          linksRewritten += 1
          const display = String(displayPart ?? "").replace(/^\|/, "").trim()
          return display || rawTarget
        }
        return full
      }

      const canonical = canonicalTarget(entry.slug, basenameCount)
      if (normalizeLinkKey(canonical) === normalizeLinkKey(rawTarget)) {
        return full
      }

      changed = true
      linksRewritten += 1
      const display = String(displayPart ?? "").replace(/^\|/, "").trim()
      const safeDisplay = display || rawTarget
      return `[[${canonical}|${safeDisplay}]]`
    })

    if (!changed) continue
    try {
      await writeFile(file.path, updated)
      filesTouched += 1
      rewrittenFiles.push(relativePath)
    } catch {
      // ignore this file and continue
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  const stubPaths: string[] = []

  if (createStubs) {
    for (const [target] of unresolvedCount) {
      if (!shouldCreateStub(target)) continue
      const fileName = sanitizeStubFileName(target)
      const relativeStubPath = `wiki/concepts/${fileName}.md`
      const fullStubPath = `${pp}/${relativeStubPath}`

      try {
        await readFile(fullStubPath)
        continue
      } catch {
        // expected when stub does not exist
      }

      const stubContent = [
        "---",
        "type: concept",
        `title: "${escapeQuote(target)}"`,
        `created: ${date}`,
        `updated: ${date}`,
        'tags: ["auto-generated", "stub"]',
        "related: []",
        `sources: ["${escapeQuote(sourceFileName)}"]`,
        `aliases: ["${escapeQuote(target)}"]`,
        "---",
        "",
        `# ${target}`,
        "",
        "This page was auto-created to resolve wikilinks.",
        "Please replace this stub with full content.",
        "",
      ].join("\n")

      try {
        await writeFile(fullStubPath, stubContent)
        stubPaths.push(relativeStubPath)
      } catch {
        // ignore stub write failures
      }
    }
  }

  // Persist latest registry after stubs are created.
  if (stubPaths.length > 0) {
    await rebuildLinkRegistry(pp)
  }

  const unresolved = Array.from(unresolvedCount.entries())
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count)

  return {
    filesTouched,
    linksRewritten,
    stubsCreated: stubPaths.length,
    rewrittenFiles,
    stubPaths,
    unresolved,
  }
}
