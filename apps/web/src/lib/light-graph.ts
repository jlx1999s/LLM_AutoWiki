import { listDirectory, readFile, writeFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { getFileName, getRelativePath, normalizePath } from "@/lib/path-utils"

const GRAPH_RELATIVE_PATH = ".llm-wiki/graph.json"
const WIKILINK_REGEX = /\[\[([^\]|]+?)(\|([^\]]+))?\]\]/g
const RESERVED_WIKI_FILES = new Set(["wiki/index.md", "wiki/log.md", "wiki/overview.md"])

export type LiteNodeKind = "source" | "entity" | "concept" | "comparison" | "query" | "synthesis" | "other"
export type LiteEdgeStatus = "confirmed" | "candidate"

export interface LiteGraphNode {
  id: string
  key: string
  name: string
  kind: LiteNodeKind
  aliases: string[]
  hasPage: boolean
  sources: string[]
  updatedAt: string
}

export interface LiteGraphEdge {
  id: string
  srcNodeId: string
  dstNodeId: string
  relation: string
  status: LiteEdgeStatus
  confidence: number
  evidenceCount: number
  updatedAt: string
}

export interface LiteGraphEvidence {
  id: string
  edgeId: string
  sourceFile: string
  pagePath: string
  snippet: string
  createdAt: string
}

export interface LiteGraphData {
  version: number
  updatedAt: string
  nodes: LiteGraphNode[]
  edges: LiteGraphEdge[]
  evidence: LiteGraphEvidence[]
}

export interface LiteGraphRelatedSyncStats {
  pagesUpdated: number
  relatedInjected: number
}

interface ParsedWikilink {
  rawTarget: string
  display: string
  index: number
}

interface UnresolvedInput {
  target: string
  count: number
}

function defaultGraphData(): LiteGraphData {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
    evidence: [],
  }
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const v = value.trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function normalizeAliasKey(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function baseNameFromKey(key: string): string {
  const parts = key.split("/")
  return parts[parts.length - 1] ?? key
}

function nodeIdFromKey(key: string): string {
  return `node:${encodeURIComponent(key)}`
}

function edgeIdFromNodes(srcNodeId: string, relation: string, dstNodeId: string): string {
  return `edge:${encodeURIComponent(srcNodeId)}:${relation}:${encodeURIComponent(dstNodeId)}`
}

function inferKindFromPath(relativePath: string): LiteNodeKind {
  const lower = relativePath.toLowerCase()
  if (lower.startsWith("wiki/sources/")) return "source"
  if (lower.startsWith("wiki/entities/")) return "entity"
  if (lower.startsWith("wiki/concepts/")) return "concept"
  if (lower.startsWith("wiki/comparisons/")) return "comparison"
  if (lower.startsWith("wiki/queries/")) return "query"
  if (lower.startsWith("wiki/synthesis/")) return "synthesis"
  return "other"
}

function extractFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  return match ? match[1] : ""
}

function extractFrontmatterField(frontmatter: string, key: string): string | null {
  if (!frontmatter) return null
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  if (!match) return null
  return match[1].trim().replace(/^["']|["']$/g, "")
}

function extractArrayValues(frontmatter: string, key: string): string[] {
  const inline = extractFrontmatterField(frontmatter, key)
  if (inline && inline.startsWith("[") && inline.endsWith("]")) {
    return uniqueStrings(
      inline
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    )
  }

  const blockMatch = frontmatter.match(new RegExp(`^${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, "m"))
  if (!blockMatch?.[1]) return []
  return uniqueStrings(
    blockMatch[1]
      .split("\n")
      .map((line) => line.match(/^\s*-\s*(.+)\s*$/)?.[1] ?? "")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean),
  )
}

function extractTitle(content: string, fallback: string): string {
  const frontmatter = extractFrontmatter(content)
  const titleFromFm = extractFrontmatterField(frontmatter, "title")
  if (titleFromFm) return titleFromFm
  const heading = content.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()
  return fallback
}

function extractAliases(content: string): string[] {
  const frontmatter = extractFrontmatter(content)
  return extractArrayValues(frontmatter, "aliases")
}

function extractRelated(content: string): string[] {
  const frontmatter = extractFrontmatter(content)
  return extractArrayValues(frontmatter, "related")
}

function parseWikilinks(content: string): ParsedWikilink[] {
  const links: ParsedWikilink[] = []
  WIKILINK_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    const rawTarget = (match[1] ?? "").split("#")[0].trim()
    if (!rawTarget) continue
    const display = (match[3] ?? rawTarget).trim()
    links.push({
      rawTarget,
      display: display || rawTarget,
      index: match.index,
    })
  }
  return links
}

function snippetAround(content: string, index: number): string {
  const start = Math.max(0, index - 60)
  const end = Math.min(content.length, index + 120)
  return content.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 180)
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "")
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function toInlineYamlList(values: string[]): string {
  return `[${values.map((v) => `"${escapeYaml(v)}"`).join(", ")}]`
}

function cjkCharCount(text: string): number {
  const match = text.match(/[\u3400-\u9fff]/g)
  return match ? match.length : 0
}

function isLikelyMentionAlias(alias: string): boolean {
  const value = alias.trim()
  if (!value) return false
  if (value.includes("/")) return false
  if (value.length > 80) return false
  if (cjkCharCount(value) >= 2) return true
  const ascii = value.replace(/[^A-Za-z0-9 _-]/g, "").trim()
  if (!ascii) return false
  if (ascii.length < 5) return false
  return /[A-Za-z]/.test(ascii)
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findMentionIndex(content: string, alias: string): number {
  if (!alias) return -1
  const hasCjk = /[\u3400-\u9fff]/.test(alias)
  if (hasCjk) {
    return content.indexOf(alias)
  }
  const escaped = escapeRegex(alias)
  const regex = new RegExp(`(^|[^A-Za-z0-9])(${escaped})(?=[^A-Za-z0-9]|$)`, "i")
  const match = regex.exec(content)
  if (!match) return -1
  const prefixLen = match[1]?.length ?? 0
  return match.index + prefixLen
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

async function collectWikiPageKeys(projectPath: string): Promise<Set<string>> {
  const keys = new Set<string>()
  try {
    const tree = await listDirectory(`${normalizePath(projectPath)}/wiki`)
    const files = flattenMdFiles(tree)
    for (const file of files) {
      const rel = `wiki/${getRelativePath(file.path, `${normalizePath(projectPath)}/wiki`)}`
      if (RESERVED_WIKI_FILES.has(rel)) continue
      keys.add(normalizeAliasKey(rel))
    }
  } catch {
    // ignore
  }
  return keys
}

async function tryRead(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

function upsertNode(
  graph: LiteGraphData,
  key: string,
  input: {
    name: string
    kind: LiteNodeKind
    aliases?: string[]
    hasPage?: boolean
    sourceFile?: string
  },
  nowIso: string,
): LiteGraphNode {
  const normalizedKey = normalizeAliasKey(key)
  const nodeId = nodeIdFromKey(normalizedKey)
  const existing = graph.nodes.find((n) => n.id === nodeId)
  if (existing) {
    existing.name = existing.name || input.name
    if (existing.kind === "other" && input.kind !== "other") {
      existing.kind = input.kind
    }
    existing.hasPage = existing.hasPage || Boolean(input.hasPage)
    existing.aliases = uniqueStrings([existing.key, existing.name, ...existing.aliases, ...(input.aliases ?? [])])
    if (input.sourceFile) {
      existing.sources = uniqueStrings([...existing.sources, input.sourceFile])
    }
    existing.updatedAt = nowIso
    return existing
  }

  const node: LiteGraphNode = {
    id: nodeId,
    key: normalizedKey,
    name: input.name || baseNameFromKey(normalizedKey),
    kind: input.kind,
    aliases: uniqueStrings([normalizedKey, input.name, ...(input.aliases ?? [])]),
    hasPage: Boolean(input.hasPage),
    sources: input.sourceFile ? [input.sourceFile] : [],
    updatedAt: nowIso,
  }
  graph.nodes.push(node)
  return node
}

function upsertEdge(
  graph: LiteGraphData,
  srcNodeId: string,
  dstNodeId: string,
  status: LiteEdgeStatus,
  confidence: number,
  nowIso: string,
): LiteGraphEdge {
  const relation = "mentions"
  const edgeId = edgeIdFromNodes(srcNodeId, relation, dstNodeId)
  const existing = graph.edges.find((e) => e.id === edgeId)
  if (existing) {
    existing.status = existing.status === "confirmed" ? "confirmed" : status
    existing.confidence = Math.max(existing.confidence, confidence)
    existing.evidenceCount += 1
    existing.updatedAt = nowIso
    return existing
  }

  const edge: LiteGraphEdge = {
    id: edgeId,
    srcNodeId,
    dstNodeId,
    relation,
    status,
    confidence,
    evidenceCount: 1,
    updatedAt: nowIso,
  }
  graph.edges.push(edge)
  return edge
}

function addEvidence(
  graph: LiteGraphData,
  edgeId: string,
  sourceFile: string,
  pagePath: string,
  snippet: string,
  nowIso: string,
): void {
  if (!snippet.trim()) return
  const id = `ev:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  graph.evidence.push({ id, edgeId, sourceFile, pagePath, snippet, createdAt: nowIso })
}

function buildAliasIndex(graph: LiteGraphData): Map<string, string> {
  const index = new Map<string, string>()
  for (const node of graph.nodes) {
    const keys = uniqueStrings([node.key, node.name, baseNameFromKey(node.key), ...node.aliases])
    for (const raw of keys) {
      const normalized = normalizeAliasKey(raw)
      if (!normalized) continue
      if (!index.has(normalized)) {
        index.set(normalized, node.key)
      }
    }
  }
  return index
}

async function loadGraph(projectPath: string): Promise<LiteGraphData> {
  const fullPath = `${normalizePath(projectPath)}/${GRAPH_RELATIVE_PATH}`
  const raw = await tryRead(fullPath)
  if (!raw.trim()) return defaultGraphData()
  try {
    const parsed = JSON.parse(raw) as LiteGraphData
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || !Array.isArray(parsed.evidence)) {
      return defaultGraphData()
    }
    return parsed
  } catch {
    return defaultGraphData()
  }
}

async function saveGraph(projectPath: string, graph: LiteGraphData): Promise<void> {
  const fullPath = `${normalizePath(projectPath)}/${GRAPH_RELATIVE_PATH}`
  await writeFile(fullPath, JSON.stringify(graph, null, 2))
}

function sourceNodeKeyFromSourceFile(sourceFileName: string): string {
  const base = getFileName(sourceFileName).replace(/\.[^.]+$/, "")
  return normalizeAliasKey(`sources/${base}`)
}

function sourceNodeKeyCandidates(sourceFileName: string): string[] {
  const base = getFileName(sourceFileName).replace(/\.[^.]+$/, "")
  const withoutProcessed = base.replace(/_processed$/i, "")
  return uniqueStrings([
    sourceNodeKeyFromSourceFile(sourceFileName),
    normalizeAliasKey(`sources/${withoutProcessed}`),
    normalizeAliasKey(withoutProcessed),
    normalizeAliasKey(base),
  ])
}

function resolveTargetKey(aliasIndex: Map<string, string>, rawTarget: string): string {
  const normalized = normalizeAliasKey(rawTarget)
  if (!normalized) return normalized
  return (
    aliasIndex.get(normalized) ??
    aliasIndex.get(baseNameFromKey(normalized)) ??
    normalized
  )
}

function collectMentionAliases(node: LiteGraphNode): string[] {
  return uniqueStrings([node.name, baseNameFromKey(node.key), ...node.aliases])
    .filter(isLikelyMentionAlias)
    .sort((a, b) => b.length - a.length)
}

function rewriteFrontmatterInlineList(content: string, key: string, values: string[]): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return content
  const frontmatter = match[1]
  const rest = content.slice(match[0].length)
  const lines = frontmatter.split("\n")
  const rewritten: string[] = []
  let replaced = false
  let skipBlockItems = false

  for (const line of lines) {
    if (!replaced && new RegExp(`^${key}:\\s*`).test(line)) {
      rewritten.push(`${key}: ${toInlineYamlList(values)}`)
      replaced = true
      skipBlockItems = true
      continue
    }
    if (skipBlockItems && /^\s*-\s+/.test(line)) {
      continue
    }
    skipBlockItems = false
    rewritten.push(line)
  }

  if (!replaced) {
    const insertAt = rewritten.findIndex((line) => /^sources:\s*/.test(line))
    if (insertAt >= 0) {
      rewritten.splice(insertAt, 0, `${key}: ${toInlineYamlList(values)}`)
    } else {
      rewritten.push(`${key}: ${toInlineYamlList(values)}`)
    }
  }

  return `---\n${rewritten.join("\n")}\n---\n${rest}`
}

export async function mergeLiteGraphFromIngest(
  projectPath: string,
  writtenPaths: string[],
  sourceFileName: string,
  unresolved: UnresolvedInput[] = [],
): Promise<LiteGraphData> {
  const pp = normalizePath(projectPath)
  const nowIso = new Date().toISOString()
  const graph = await loadGraph(pp)
  const pageKeys = await collectWikiPageKeys(pp)

  for (const node of graph.nodes) {
    node.hasPage = pageKeys.has(node.key)
  }

  let aliasIndex = buildAliasIndex(graph)
  let sourceAnchorNodeId: string | null = null

  for (const relPath of writtenPaths) {
    if (!relPath.startsWith("wiki/") || !relPath.endsWith(".md")) continue
    if (RESERVED_WIKI_FILES.has(relPath)) continue

    const fullPath = `${pp}/${relPath}`
    const content = await tryRead(fullPath)
    if (!content.trim()) continue

    const pageKey = normalizeAliasKey(relPath)
    const fallbackName = getFileName(relPath).replace(/\.md$/i, "")
    const title = extractTitle(content, fallbackName)
    const aliases = extractAliases(content)
    const related = extractRelated(content)
    const kind = inferKindFromPath(relPath)
    const srcNode = upsertNode(
      graph,
      pageKey,
      { name: title, kind, aliases: [fallbackName, ...aliases], hasPage: true, sourceFile: sourceFileName },
      nowIso,
    )
    if (kind === "source") {
      sourceAnchorNodeId = srcNode.id
    }

    aliasIndex = buildAliasIndex(graph)
    const links = parseWikilinks(content)
    for (const link of links) {
      const resolvedTargetKey = resolveTargetKey(aliasIndex, link.rawTarget)
      if (!resolvedTargetKey) continue
      const hasPage = pageKeys.has(resolvedTargetKey)
      const targetNode = upsertNode(
        graph,
        resolvedTargetKey,
        {
          name: link.display || baseNameFromKey(resolvedTargetKey),
          kind: hasPage ? "concept" : "other",
          aliases: [link.rawTarget, link.display],
          hasPage,
          sourceFile: sourceFileName,
        },
        nowIso,
      )
      const status: LiteEdgeStatus = targetNode.hasPage ? "confirmed" : "candidate"
      const edge = upsertEdge(graph, srcNode.id, targetNode.id, status, status === "confirmed" ? 0.8 : 0.45, nowIso)
      addEvidence(graph, edge.id, sourceFileName, relPath, snippetAround(content, link.index), nowIso)
    }

    for (const relatedItem of related) {
      const resolvedTargetKey = resolveTargetKey(aliasIndex, relatedItem)
      if (!resolvedTargetKey) continue
      const hasPage = pageKeys.has(resolvedTargetKey)
      const targetNode = upsertNode(
        graph,
        resolvedTargetKey,
        {
          name: baseNameFromKey(resolvedTargetKey),
          kind: hasPage ? "concept" : "other",
          aliases: [relatedItem],
          hasPage,
          sourceFile: sourceFileName,
        },
        nowIso,
      )
      const status: LiteEdgeStatus = targetNode.hasPage ? "confirmed" : "candidate"
      const edge = upsertEdge(graph, srcNode.id, targetNode.id, status, status === "confirmed" ? 0.75 : 0.4, nowIso)
      addEvidence(graph, edge.id, sourceFileName, relPath, `related: ${relatedItem}`, nowIso)
    }
  }

  if (unresolved.length > 0) {
    let sourceNode =
      (sourceAnchorNodeId ? graph.nodes.find((n) => n.id === sourceAnchorNodeId) : null) ??
      graph.nodes.find((n) => n.kind === "source" && n.sources.includes(sourceFileName)) ??
      graph.nodes.find((n) => sourceNodeKeyCandidates(sourceFileName).includes(n.key)) ??
      null

    if (!sourceNode) {
      const fallbackSourceKey = sourceNodeKeyCandidates(sourceFileName)[0] ?? sourceNodeKeyFromSourceFile(sourceFileName)
      sourceNode = upsertNode(
        graph,
        fallbackSourceKey,
        {
          name: getFileName(sourceFileName).replace(/\.[^.]+$/, ""),
          kind: "source",
          aliases: sourceNodeKeyCandidates(sourceFileName),
          hasPage: pageKeys.has(fallbackSourceKey),
          sourceFile: sourceFileName,
        },
        nowIso,
      )
    }

    aliasIndex = buildAliasIndex(graph)
    for (const item of unresolved) {
      const unresolvedKey = resolveTargetKey(aliasIndex, item.target)
      if (!unresolvedKey) continue
      const targetNode = upsertNode(
        graph,
        unresolvedKey,
        {
          name: item.target,
          kind: "other",
          aliases: [item.target],
          hasPage: pageKeys.has(unresolvedKey),
          sourceFile: sourceFileName,
        },
        nowIso,
      )
      const edge = upsertEdge(graph, sourceNode.id, targetNode.id, "candidate", 0.2, nowIso)
      for (let i = 0; i < Math.max(item.count, 1); i += 1) {
        addEvidence(graph, edge.id, sourceFileName, `source:${sourceFileName}`, `Unresolved link: ${item.target}`, nowIso)
      }
    }
  }

  // Scan plain-text mentions to recover relations even when wikilinks are missing/broken.
  // This makes relation extraction less dependent on model-specific link formatting.
  const pageNodes = graph.nodes.filter((node) => node.hasPage)
  const pageNodeByKey = new Map(pageNodes.map((node) => [node.key, node] as const))
  const mentionTargets = pageNodes.map((node) => ({ node, aliases: collectMentionAliases(node) }))

  for (const relPath of writtenPaths) {
    if (!relPath.startsWith("wiki/") || !relPath.endsWith(".md")) continue
    if (RESERVED_WIKI_FILES.has(relPath)) continue
    const srcKey = normalizeAliasKey(relPath)
    const srcNode = pageNodeByKey.get(srcKey)
    if (!srcNode) continue

    const fullPath = `${pp}/${relPath}`
    const raw = await tryRead(fullPath)
    const body = stripFrontmatter(raw)
    if (!body.trim()) continue

    let mentionEdgesAdded = 0
    for (const { node: targetNode, aliases } of mentionTargets) {
      if (targetNode.id === srcNode.id) continue
      let matchedIndex = -1
      for (const alias of aliases) {
        matchedIndex = findMentionIndex(body, alias)
        if (matchedIndex >= 0) break
      }
      if (matchedIndex < 0) continue

      const edge = upsertEdge(graph, srcNode.id, targetNode.id, "confirmed", 0.62, nowIso)
      addEvidence(graph, edge.id, sourceFileName, relPath, snippetAround(body, matchedIndex), nowIso)
      mentionEdgesAdded += 1
      if (mentionEdgesAdded >= 24) break
    }
  }

  if (graph.evidence.length > 3000) {
    graph.evidence = graph.evidence.slice(graph.evidence.length - 3000)
  }
  graph.updatedAt = nowIso
  await saveGraph(pp, graph)
  return graph
}

export async function syncRelatedFromLiteGraph(
  projectPath: string,
  writtenPaths: string[],
): Promise<LiteGraphRelatedSyncStats> {
  const pp = normalizePath(projectPath)
  const graph = await loadGraph(pp)
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const))
  const outgoing = new Map<string, LiteGraphEdge[]>()

  for (const edge of graph.edges) {
    if (edge.status !== "confirmed") continue
    const dst = nodeById.get(edge.dstNodeId)
    if (!dst?.hasPage) continue
    const list = outgoing.get(edge.srcNodeId) ?? []
    list.push(edge)
    outgoing.set(edge.srcNodeId, list)
  }

  let pagesUpdated = 0
  let relatedInjected = 0

  for (const relPath of writtenPaths) {
    if (!relPath.startsWith("wiki/") || !relPath.endsWith(".md")) continue
    if (RESERVED_WIKI_FILES.has(relPath)) continue

    const srcKey = normalizeAliasKey(relPath)
    const srcNode = graph.nodes.find((node) => node.key === srcKey && node.hasPage)
    if (!srcNode) continue

    const edges = [...(outgoing.get(srcNode.id) ?? [])]
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence
        return b.evidenceCount - a.evidenceCount
      })

    if (edges.length === 0) continue

    const graphRelated = uniqueStrings(
      edges
        .map((edge) => nodeById.get(edge.dstNodeId)?.key ?? "")
        .filter((key) => key && key !== srcNode.key && key.includes("/")),
    ).slice(0, 15)

    if (graphRelated.length === 0) continue

    const fullPath = `${pp}/${relPath}`
    const content = await tryRead(fullPath)
    if (!content.trim()) continue
    const mergedRelated = graphRelated

    const updated = rewriteFrontmatterInlineList(content, "related", mergedRelated)
    if (updated === content) continue
    try {
      await writeFile(fullPath, updated)
      pagesUpdated += 1
      relatedInjected += mergedRelated.length
    } catch {
      // non-critical
    }
  }

  return { pagesUpdated, relatedInjected }
}
