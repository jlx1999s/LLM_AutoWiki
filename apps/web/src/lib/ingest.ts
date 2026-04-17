import { createDirectory, readFile, writeFile, listDirectory, deleteFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useActivityStore } from "@/stores/activity-store"
import { useReviewStore } from "@/stores/review-store"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { checkIngestCache, saveIngestCache } from "@/lib/ingest-cache"
import { autoRepairWikiLinks, type AutoLinkRepairStats } from "@/lib/auto-link-repair"
import { parseReviewBlocks } from "@/lib/ingest-review"
import { buildGraphExtractionPrompt, LANGUAGE_RULE } from "@/lib/ingest-prompts"
import { mergeLiteGraphFromIngest, syncRelatedFromLiteGraph } from "@/lib/light-graph"
import {
  parseStructuredExtractionCandidate,
  type CompiledWikiResult,
  type CompiledWikiFile,
  type StructuredExtraction,
} from "@/lib/graph-first-ingest"
import {
  runStructuredIngestPipeline,
  summarizeStructuredQualityErrors,
} from "@/lib/structured-ingest-pipeline"

const FILE_BLOCK_REGEX = /---FILE:\s*([^\n]+?)\s*---\n([\s\S]*?)---END FILE---/g
const RESERVED_WIKI_PATHS = new Set(["wiki/index.md", "wiki/log.md", "wiki/overview.md"])
const STRUCTURED_DIRS = new Set(["sources", "entities", "concepts", "comparisons", "queries", "synthesis"])
const ALLOWED_TYPES = new Set(["source", "entity", "concept", "comparison", "query", "synthesis", "overview"])
const MIN_SOURCE_CONTENT_CHARS = 40

interface WriteRollbackEntry {
  relativePath: string
  existed: boolean
  previousContent: string
}

interface WriteBatchResult {
  writtenPaths: string[]
  rollbackEntries: WriteRollbackEntry[]
}

export { LANGUAGE_RULE }

/**
 * Auto-ingest: reads source → LLM extracts structured graph → compiler writes wiki pages.
 * Used when importing new files.
 */
export async function autoIngest(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
  folderContext?: string,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const activity = useActivityStore.getState()
  const fileName = getFileName(sp)
  const activityId = activity.addItem({
    type: "ingest",
    title: fileName,
    status: "running",
    detail: "Reading source...",
    filesWritten: [],
  })

  const [sourceContent, purpose, index] = await Promise.all([
    readSourceText(sp),
    tryReadFile(`${pp}/purpose.md`),
    tryReadFile(`${pp}/wiki/index.md`),
  ])

  if (sourceContent.trim().length < MIN_SOURCE_CONTENT_CHARS) {
    const msg = [
      `Source appears empty or unreadable (${sourceContent.trim().length} chars).`,
      "This usually means the upload did not copy correctly or text extraction failed.",
      "Please re-import the file and retry ingest.",
    ].join(" ")
    activity.updateItem(activityId, { status: "error", detail: msg, filesWritten: [] })
    throw new Error(msg)
  }

  // ── Cache check: skip re-ingest if source content hasn't changed ──
  const cachedFiles = await checkIngestCache(pp, fileName, sourceContent)
  if (cachedFiles !== null) {
    activity.updateItem(activityId, {
      status: "done",
      detail: `Skipped (unchanged) — ${cachedFiles.length} files from previous ingest`,
      filesWritten: cachedFiles,
    })
    return cachedFiles
  }

  const truncatedContent = sourceContent.length > 50000
    ? sourceContent.slice(0, 50000) + "\n\n[...truncated...]"
    : sourceContent

  // ── Step 1: Structured extraction ─────────────────────────────
  activity.updateItem(activityId, { detail: "Step 1/2: Extracting structured graph..." })

  let extractionRaw = ""
  let ingestError: string | null = null

  await streamChat(
    llmConfig,
    [
      { role: "system", content: buildGraphExtractionPrompt(purpose, index, fileName) },
      {
        role: "user",
        content: [
          `Extract a structured knowledge graph from this source.`,
          "",
          `File: ${fileName}`,
          folderContext ? `Folder context: ${folderContext}` : "",
          "",
          "Source content:",
          truncatedContent,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    {
      onToken: (token) => { extractionRaw += token },
      onDone: () => {},
      onError: (err) => {
        ingestError = `Analysis failed: ${err.message}`
        activity.updateItem(activityId, { status: "error", detail: ingestError })
      },
    },
    signal,
  )

  if (useActivityStore.getState().items.find((i) => i.id === activityId)?.status === "error") {
    throw new Error(ingestError ?? "Analysis failed")
  }

  let extractionJson = ""
  try {
    extractionJson = await parseStructuredWithRepair(
      extractionRaw,
      llmConfig,
      purpose,
      index,
      fileName,
      signal,
      () => activity.updateItem(activityId, { detail: "Repairing extraction JSON..." }),
    )
  } catch (err) {
    const msg = `Structured extraction failed: ${err instanceof Error ? err.message : String(err)}`
    activity.updateItem(activityId, { status: "error", detail: msg, filesWritten: [] })
    throw new Error(msg)
  }

  let structured: StructuredExtraction | null = null
  let compiled: CompiledWikiResult | null = null
  const graphQualityErrors: string[] = []
  const graphQualityWarnings: string[] = []
  let pipelineQualityReport: unknown = null
  try {
    const pipeline = runStructuredIngestPipeline({
      raw: extractionJson,
      sourceFileName: fileName,
    })
    pipelineQualityReport = {
      sourceFileName: fileName,
      generatedAt: new Date().toISOString(),
      candidate: pipeline.candidate,
      extraction: {
        sourceTitle: pipeline.extraction.sourceTitle,
        sourceSummary: pipeline.extraction.sourceSummary,
        nodes: pipeline.extraction.nodes.length,
        edges: pipeline.extraction.edges.length,
        unresolved: pipeline.extraction.unresolved.length,
      },
      quality: pipeline.quality,
      compiledStats: pipeline.compiled.stats,
    }
    structured = pipeline.extraction
    compiled = pipeline.compiled
    const qualityErrors = summarizeStructuredQualityErrors(pipeline.quality)
    graphQualityErrors.push(...qualityErrors)
    graphQualityWarnings.push(
      ...pipeline.quality.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => `${issue.code}: ${issue.message}`),
    )
  } catch (err) {
    const msg = `Structured extraction normalization failed: ${err instanceof Error ? err.message : String(err)}`
    activity.updateItem(activityId, { status: "error", detail: msg, filesWritten: [] })
    throw new Error(msg)
  }

  if (graphQualityErrors.length > 0) {
    const msg = `Quality gate failed: ${graphQualityErrors.join(" | ")}`
    if (pipelineQualityReport) {
      await persistStructuredPipelineReport(pp, fileName, pipelineQualityReport).catch(() => {})
    }
    activity.updateItem(activityId, { status: "error", detail: msg, filesWritten: [] })
    throw new Error(msg)
  }

  if (pipelineQualityReport) {
    await persistStructuredPipelineReport(pp, fileName, pipelineQualityReport).catch(() => {})
  }

  // ── Step 2: Compile + write ───────────────────────────────────
  activity.updateItem(activityId, { detail: "Step 2/2: Compiling wiki pages..." })

  if (!structured || !compiled) {
    const msg = "Structured pipeline returned empty result"
    activity.updateItem(activityId, { status: "error", detail: msg, filesWritten: [] })
    throw new Error(msg)
  }

  if (compiled.files.length === 0) {
    const msg = "No wiki files generated from structured extraction"
    activity.updateItem(activityId, { status: "error", detail: msg, filesWritten: [] })
    throw new Error(msg)
  }

  const writeBatch = await writeCompiledFiles(pp, compiled.files)
  const writtenPaths = writeBatch.writtenPaths
  const rollbackEntries = writeBatch.rollbackEntries
  const rollbackIndex = new Set(rollbackEntries.map((entry) => entry.relativePath))
  let repairStats: AutoLinkRepairStats = {
    filesTouched: 0,
    linksRewritten: 0,
    stubsCreated: 0,
    rewrittenFiles: [],
    stubPaths: [],
    unresolved: [],
  }

  const staleRemoved = await pruneStaleSourcePages(pp, fileName, new Set(compiled.files.map((file) => file.path)), rollbackEntries, rollbackIndex)
  const supplementalPaths = await upsertSupplementalPages(
    pp,
    fileName,
    structured,
    rollbackEntries,
    rollbackIndex,
  )
  for (const path of [...supplementalPaths, ...staleRemoved]) {
    if (!writtenPaths.includes(path)) writtenPaths.push(path)
  }

  // ── Step 3.5: Auto repair wikilinks (rewrite unresolved links, no auto-stubs) ───────
  activity.updateItem(activityId, { detail: "Repairing wiki links..." })
  try {
    repairStats = await autoRepairWikiLinks(pp, fileName, {
      createStubs: false,
      replaceUnresolvedWithText: false,
    })
    for (const path of repairStats.stubPaths) {
      if (!writtenPaths.includes(path)) writtenPaths.push(path)
    }
    for (const path of repairStats.rewrittenFiles) {
      const normalized = `wiki/${path}`
      if (!writtenPaths.includes(normalized)) writtenPaths.push(normalized)
    }
  } catch {
    // non-critical
  }

  // Keep unresolved candidates from structured graph in activity and light-graph candidate pool.
  repairStats.unresolved = mergeUnresolved(repairStats.unresolved, compiled.unresolved)

  const qualityIssues = await evaluateIngestQuality(pp, writtenPaths, repairStats)
  if (qualityIssues.length > 0) {
    const msg = `Quality gate failed: ${qualityIssues.join(" | ")}`
    await rollbackWrittenFiles(pp, rollbackEntries)
    await cleanupGeneratedStubs(pp, repairStats.stubPaths)
    activity.updateItem(activityId, {
      status: "error",
      detail: `${msg} (changes rolled back)`,
      filesWritten: [],
    })
    throw new Error(msg)
  }

  let graphCandidates = 0
  let relatedSyncSummary = ""
  try {
    const graph = await mergeLiteGraphFromIngest(pp, writtenPaths, fileName, repairStats.unresolved)
    graphCandidates = graph.edges.filter((e) => e.status === "candidate").length
    const relatedSync = await syncRelatedFromLiteGraph(pp, writtenPaths)
    if (relatedSync.pagesUpdated > 0) {
      relatedSyncSummary = `, related synced ${relatedSync.pagesUpdated} page(s)`
    }
  } catch {
    // non-critical
  }

  if (writtenPaths.length > 0) {
    try {
      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
    } catch {
      // ignore
    }
  }

  // ── Step 4: Parse review items ────────────────────────────────
  const reviewBlocks = buildSuggestionReviewBlocks(compiled.openQuestions, compiled.sourcePath)
  const reviewItems = parseReviewBlocks(reviewBlocks, sp)
  if (reviewItems.length > 0) {
    useReviewStore.getState().addItems(reviewItems)
  }

  // ── Step 5: Save to cache ───────────────────────────────────
  if (writtenPaths.length > 0) {
    await saveIngestCache(pp, fileName, sourceContent, writtenPaths)
  }

  // ── Step 6: Generate embeddings (if enabled) ───────────────
  const embCfg = useWikiStore.getState().embeddingConfig
  if (embCfg.enabled && embCfg.model && writtenPaths.length > 0) {
    try {
      const { embedPage } = await import("@/lib/embedding")
      for (const wpath of writtenPaths) {
        const pageId = wpath.split("/").pop()?.replace(/\.md$/, "") ?? ""
        if (!pageId || ["index", "log", "overview"].includes(pageId)) continue
        try {
          const content = await readFile(`${pp}/${wpath}`)
          const titleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
          const title = titleMatch ? titleMatch[1].trim() : pageId
          await embedPage(pp, pageId, title, content, embCfg)
        } catch {
          // non-critical
        }
      }
    } catch {
      // embedding module not available
    }
  }

  const detail = writtenPaths.length > 0
    ? `${writtenPaths.length} files written, ${compiled.stats.nodeCount} nodes, ${compiled.stats.edgeCount} semantic edges${reviewItems.length > 0 ? `, ${reviewItems.length} review item(s)` : ""}${repairStats.linksRewritten > 0 || repairStats.stubsCreated > 0 ? `, ${repairStats.linksRewritten} links fixed, ${repairStats.stubsCreated} stubs created` : ""}${repairStats.unresolved.length > 0 ? `, ${repairStats.unresolved.length} unresolved captured` : ""}${graphCandidates > 0 ? `, graph candidates ${graphCandidates}` : ""}${relatedSyncSummary}${graphQualityWarnings.length > 0 ? `, ${graphQualityWarnings.length} quality warning(s)` : ""}`
    : "No files generated"

  activity.updateItem(activityId, {
    status: writtenPaths.length > 0 ? "done" : "error",
    detail,
    filesWritten: writtenPaths,
  })

  return writtenPaths
}

async function parseStructuredWithRepair(
  raw: string,
  llmConfig: LlmConfig,
  purpose: string,
  index: string,
  sourceFileName: string,
  signal?: AbortSignal,
  onRepairStart?: () => void,
): Promise<string> {
  try {
    parseStructuredExtractionCandidate(raw, sourceFileName)
    return raw
  } catch {
    // fall through to repair
  }

  onRepairStart?.()

  let repaired = ""
  let repairError: Error | null = null
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "You are a strict JSON normalizer.",
          "Return ONLY one valid JSON object, no markdown, no explanations.",
          buildGraphExtractionPrompt(purpose, index, sourceFileName),
        ].join("\n\n"),
      },
      {
        role: "user",
        content: [
          "Convert the previous model output into valid JSON according to the schema.",
          "Do not invent new facts. Preserve original intent.",
          "",
          "Previous output:",
          raw.slice(0, 40000),
        ].join("\n"),
      },
    ],
    {
      onToken: (token) => { repaired += token },
      onDone: () => {},
      onError: (err) => { repairError = err },
    },
    signal,
  )

  if (repairError) {
    throw new Error(`JSON repair failed: ${repairError.message}`)
  }

  parseStructuredExtractionCandidate(repaired, sourceFileName)
  return repaired
}

function slugForReportFile(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "source"
}

async function persistStructuredPipelineReport(
  projectPath: string,
  sourceFileName: string,
  report: unknown,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const reportsDir = `${pp}/.llm-wiki/ingest-reports`
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await createDirectory(reportsDir).catch(() => {})
  const sourceSlug = slugForReportFile(getFileName(sourceFileName))
  const latestPath = `${reportsDir}/${sourceSlug}.latest.json`
  await writeFile(latestPath, JSON.stringify(report, null, 2))
}

async function writeCompiledFiles(
  projectPath: string,
  files: CompiledWikiFile[],
): Promise<WriteBatchResult> {
  const writtenPaths: string[] = []
  const rollbackEntries: WriteRollbackEntry[] = []
  const rollbackIndex = new Set<string>()

  for (const file of files) {
    const safePath = normalizeGeneratedPath(file.path)
    if (!safePath) continue
    const relativePath = safePath
    const normalizedContent = normalizeInternalLinks(file.content)
    const fullPath = `${projectPath}/${relativePath}`
    try {
      if (!rollbackIndex.has(relativePath)) {
        const previous = await readFileWithExistence(fullPath)
        rollbackEntries.push({
          relativePath,
          existed: previous.exists,
          previousContent: previous.content,
        })
        rollbackIndex.add(relativePath)
      }
      await writeFile(fullPath, normalizedContent)
      if (!writtenPaths.includes(relativePath)) writtenPaths.push(relativePath)
    } catch (err) {
      console.error(`Failed to write ${fullPath}:`, err)
    }
  }

  return { writtenPaths, rollbackEntries }
}

interface TreeNode {
  name: string
  path: string
  is_dir: boolean
  children?: TreeNode[]
}

function flattenMarkdownPaths(nodes: TreeNode[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      out.push(...flattenMarkdownPaths(node.children))
      continue
    }
    if (!node.is_dir && node.name.endsWith(".md")) {
      out.push(node.path)
    }
  }
  return out
}

async function writeWithRollback(
  projectPath: string,
  relativePath: string,
  content: string,
  rollbackEntries: WriteRollbackEntry[],
  rollbackIndex: Set<string>,
  writtenPaths: string[],
): Promise<void> {
  const safePath = normalizeGeneratedPath(relativePath)
  if (!safePath) return
  const fullPath = `${projectPath}/${safePath}`
  if (!rollbackIndex.has(safePath)) {
    const previous = await readFileWithExistence(fullPath)
    rollbackEntries.push({
      relativePath: safePath,
      existed: previous.exists,
      previousContent: previous.content,
    })
    rollbackIndex.add(safePath)
  }
  await writeFile(fullPath, content)
  if (!writtenPaths.includes(safePath)) writtenPaths.push(safePath)
}

async function deleteWithRollback(
  projectPath: string,
  relativePath: string,
  rollbackEntries: WriteRollbackEntry[],
  rollbackIndex: Set<string>,
): Promise<void> {
  const safePath = normalizeGeneratedPath(relativePath)
  if (!safePath) return
  const fullPath = `${projectPath}/${safePath}`
  if (!rollbackIndex.has(safePath)) {
    const previous = await readFileWithExistence(fullPath)
    rollbackEntries.push({
      relativePath: safePath,
      existed: previous.exists,
      previousContent: previous.content,
    })
    rollbackIndex.add(safePath)
  }
  await deleteFile(fullPath)
}

async function pruneStaleSourcePages(
  projectPath: string,
  sourceFileName: string,
  keepPaths: Set<string>,
  rollbackEntries: WriteRollbackEntry[],
  rollbackIndex: Set<string>,
): Promise<string[]> {
  const staleDeleted: string[] = []
  const wikiRoot = `${projectPath}/wiki`
  let tree: TreeNode[]
  try {
    tree = await listDirectory(wikiRoot) as TreeNode[]
  } catch {
    return staleDeleted
  }

  const markdownFiles = flattenMarkdownPaths(tree)
  for (const fullPath of markdownFiles) {
    const relativePath = `wiki/${fullPath.replace(`${wikiRoot}/`, "")}`
    if (RESERVED_WIKI_PATHS.has(relativePath)) continue
    if (keepPaths.has(relativePath)) continue

    const content = await tryReadFile(fullPath)
    if (!content.trim()) continue
    const sources = parseYamlArray(extractFrontmatterBlock(content), "sources")
    if (!sources.includes(sourceFileName)) continue
    if (sources.length > 1) continue
    try {
      await deleteWithRollback(projectPath, relativePath, rollbackEntries, rollbackIndex)
      staleDeleted.push(relativePath)
    } catch {
      // non-critical
    }
  }
  return staleDeleted
}

async function buildIndexContent(projectPath: string): Promise<string> {
  const wikiRoot = `${projectPath}/wiki`
  let tree: TreeNode[]
  try {
    tree = await listDirectory(wikiRoot) as TreeNode[]
  } catch {
    return "# Wiki Index\n"
  }

  const markdownFiles = flattenMarkdownPaths(tree)
  const grouped = new Map<string, Array<{ target: string; title: string }>>()

  for (const fullPath of markdownFiles) {
    const relative = `wiki/${fullPath.replace(`${wikiRoot}/`, "")}`
    if (RESERVED_WIKI_PATHS.has(relative)) continue
    const content = await tryReadFile(fullPath)
    const type = inferType(relative, content)
    const frontmatter = extractFrontmatterBlock(content)
    const title =
      extractFrontmatterField(frontmatter, "title")?.replace(/^["']|["']$/g, "") ??
      extractHeadingTitle(content) ??
      getFileName(fullPath).replace(/\.md$/i, "")
    const target = relative.replace(/^wiki\//, "").replace(/\.md$/i, "")
    const list = grouped.get(type) ?? []
    list.push({ target, title })
    grouped.set(type, list)
  }

  const sectionOrder: Array<{ key: string; heading: string }> = [
    { key: "source", heading: "Sources" },
    { key: "entity", heading: "Entities" },
    { key: "concept", heading: "Concepts" },
    { key: "comparison", heading: "Comparisons" },
    { key: "query", heading: "Queries" },
    { key: "synthesis", heading: "Synthesis" },
    { key: "other", heading: "Other" },
  ]

  const lines: string[] = [
    "# Wiki Index",
    "",
    `_Updated: ${new Date().toISOString().slice(0, 10)}_`,
    "",
  ]

  for (const section of sectionOrder) {
    const entries = (grouped.get(section.key) ?? []).sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"))
    if (entries.length === 0) continue
    lines.push(`## ${section.heading}`)
    for (const entry of entries) {
      lines.push(`- [[${entry.target}|${entry.title}]]`)
    }
    lines.push("")
  }

  if (lines[lines.length - 1] !== "") lines.push("")
  return lines.join("\n")
}

async function upsertSupplementalPages(
  projectPath: string,
  sourceFileName: string,
  extraction: StructuredExtraction,
  rollbackEntries: WriteRollbackEntry[],
  rollbackIndex: Set<string>,
): Promise<string[]> {
  const writtenPaths: string[] = []

  try {
    const indexContent = await buildIndexContent(projectPath)
    await writeWithRollback(projectPath, "wiki/index.md", indexContent, rollbackEntries, rollbackIndex, writtenPaths)
  } catch {
    // non-critical
  }

  try {
    const logPath = "wiki/log.md"
    const fullLogPath = `${projectPath}/${logPath}`
    const existing = await tryReadFile(fullLogPath)
    const date = new Date().toISOString().slice(0, 10)
    const logEntry = [
      `## [${date}] ingest | ${sourceFileName}`,
      "",
      `- Structured graph: ${extraction.nodes.length} nodes, ${extraction.edges.length} edges`,
      extraction.unresolved.length > 0
        ? `- Unresolved candidates: ${extraction.unresolved.slice(0, 8).join(", ")}`
        : "- Unresolved candidates: none",
    ].join("\n")
    const nextLog = existing.trim() ? `${existing.trim()}\n\n${logEntry}\n` : `${logEntry}\n`
    await writeWithRollback(projectPath, logPath, nextLog, rollbackEntries, rollbackIndex, writtenPaths)
  } catch {
    // non-critical
  }

  try {
    const overviewPath = "wiki/overview.md"
    const fullOverviewPath = `${projectPath}/${overviewPath}`
    const existingOverview = await tryReadFile(fullOverviewPath)
    const date = new Date().toISOString().slice(0, 10)
    if (!existingOverview.trim()) {
      const overview = [
        "# Wiki Overview",
        "",
        extraction.sourceSummary,
        "",
        `Latest source: ${sourceFileName} (${date})`,
        "",
      ].join("\n")
      await writeWithRollback(projectPath, overviewPath, overview, rollbackEntries, rollbackIndex, writtenPaths)
    } else if (!existingOverview.includes(sourceFileName)) {
      const updateBlock = [
        "",
        `## Update ${date}`,
        "",
        `- Source: ${sourceFileName}`,
        `- Structured graph: ${extraction.nodes.length} nodes, ${extraction.edges.length} edges`,
      ].join("\n")
      const nextOverview = `${existingOverview.trim()}\n${updateBlock}\n`
      await writeWithRollback(projectPath, overviewPath, nextOverview, rollbackEntries, rollbackIndex, writtenPaths)
    }
  } catch {
    // non-critical
  }

  return writtenPaths
}

function mergeUnresolved(
  baseline: Array<{ target: string; count: number }>,
  extraTargets: string[],
): Array<{ target: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of baseline) {
    const key = item.target.trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, item.count))
  }
  for (const target of extraTargets) {
    const key = target.trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([target, count]) => ({ target, count }))
}

function buildSuggestionReviewBlocks(openQuestions: string[], sourcePagePath: string): string {
  const questions = uniq(openQuestions).slice(0, 8)
  if (questions.length === 0) return ""

  const blocks = questions.map((question, idx) => [
    `---REVIEW: suggestion | Follow-up Question ${idx + 1}---`,
    question,
    "OPTIONS: Create Page | Skip",
    `PAGES: ${sourcePagePath}`,
    `SEARCH: ${question}`,
    "---END REVIEW---",
  ].join("\n"))

  return blocks.join("\n\n")
}

async function writeFileBlocks(
  projectPath: string,
  text: string,
  sourceFileName: string,
): Promise<WriteBatchResult> {
  const writtenPaths: string[] = []
  const rollbackEntries: WriteRollbackEntry[] = []
  const rollbackIndex = new Set<string>()
  const matches = text.matchAll(FILE_BLOCK_REGEX)

  for (const match of matches) {
    const rawPath = match[1].trim()
    const safePath = normalizeGeneratedPath(rawPath)
    const content = match[2]
    if (!safePath) {
      console.warn(`[Ingest] Skipping unsafe output path from model: ${rawPath}`)
      continue
    }

    const relativePath = rewriteGeneratedPath(safePath, content)
    const normalizedContent = normalizeGeneratedContent(relativePath, content, sourceFileName)
    const fullPath = `${projectPath}/${relativePath}`
    try {
      if (!rollbackIndex.has(relativePath)) {
        const previous = await readFileWithExistence(fullPath)
        rollbackEntries.push({
          relativePath,
          existed: previous.exists,
          previousContent: previous.content,
        })
        rollbackIndex.add(relativePath)
      }

      if (relativePath === "wiki/log.md" || relativePath.endsWith("/log.md")) {
        const existing = await tryReadFile(fullPath)
        const appended = existing ? `${existing}\n\n${normalizedContent.trim()}` : normalizedContent.trim()
        await writeFile(fullPath, appended)
      } else {
        await writeFile(fullPath, normalizedContent)
      }
      if (!writtenPaths.includes(relativePath)) writtenPaths.push(relativePath)
    } catch (err) {
      console.error(`Failed to write ${fullPath}:`, err)
    }
  }

  return { writtenPaths, rollbackEntries }
}

function normalizeGeneratedPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "")
  if (!normalized) return null
  if (normalized.startsWith("/")) return null
  if (!normalized.startsWith("wiki/")) return null
  if (normalized.includes("/../") || normalized.startsWith("../") || normalized.endsWith("/..")) return null
  return normalized
}

function slugifyFileName(raw: string): string {
  const base = raw
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "untitled"
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function toInlineYamlList(values: string[]): string {
  return `[${values.map((v) => `"${escapeYaml(v)}"`).join(", ")}]`
}

function uniq(values: string[]): string[] {
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

function extractFrontmatterBlock(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  return match ? match[1] : ""
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "")
}

function unwrapOuterMarkdownFence(content: string): string {
  const trimmed = content.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```$/i)
  return match?.[1]?.trim() ?? content
}

function stripTemplatedFencedFrontmatter(content: string): string {
  const templateFence = /```ya?ml\s*\r?\n---\r?\n([\s\S]{0,5000}?)\r?\n---\r?\n```/gi
  return content.replace(templateFence, (full, inner) => {
    const lower = String(inner ?? "").toLowerCase()
    const keys = ["type:", "title:", "created:", "updated:", "tags:", "related:", "sources:"]
    const matched = keys.filter((k) => lower.includes(k)).length
    return matched >= 2 ? "" : full
  })
}

function extractFrontmatterField(frontmatter: string, key: string): string | null {
  if (!frontmatter) return null
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match ? match[1].trim() : null
}

function parseYamlArray(frontmatter: string, key: string): string[] {
  if (!frontmatter) return []

  const inline = extractFrontmatterField(frontmatter, key)
  if (inline && inline.startsWith("[") && inline.endsWith("]")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }

  const blockMatch = frontmatter.match(new RegExp(`^${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, "m"))
  if (!blockMatch) return []

  return blockMatch[1]
    .split("\n")
    .map((line) => line.match(/^\s*-\s*(.+)\s*$/)?.[1] ?? "")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

function normalizeWikilinkTarget(raw: string): string | null {
  let target = raw.split("#")[0].trim()
  if (!target) return null
  if (target.startsWith("#")) return null
  if (target.includes("://") || target.startsWith("mailto:")) return null

  target = target
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^wiki\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")

  if (!target || target.includes("/../") || target.startsWith("../")) return null
  return target
}

function normalizeInternalLinks(content: string): string {
  const markdownNormalized = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, text, href) => {
    const target = normalizeWikilinkTarget(String(href))
    if (!target) return full
    const label = String(text).trim() || target
    return `[[${target}|${label}]]`
  })

  return markdownNormalized.replace(/\[\[([^\]|]+?)(\|[^\]]+)?\]\]/g, (full, rawTarget, displayPart) => {
    const target = normalizeWikilinkTarget(String(rawTarget))
    if (!target) return full
    const display = displayPart ? String(displayPart).replace(/^\|/, "").trim() : ""
    if (!display) return `[[${target}]]`
    return `[[${target}|${display}]]`
  })
}

function extractHeadingTitle(content: string): string | null {
  const headingMatch = content.match(/^#\s+(.+)$/m)
  return headingMatch ? headingMatch[1].trim() : null
}

function inferTypeFromText(path: string, content: string): string {
  const lowerPath = path.toLowerCase()
  if (lowerPath.includes("/entities/")) return "entity"
  if (lowerPath.includes("/concepts/")) return "concept"
  if (lowerPath.includes("/sources/")) return "source"
  if (lowerPath.includes("/comparisons/")) return "comparison"
  if (lowerPath.includes("/queries/")) return "query"
  if (lowerPath.includes("/synthesis/")) return "synthesis"
  if (lowerPath.endsWith("/overview.md")) return "overview"

  const lower = content.toLowerCase()
  const heading = (extractHeadingTitle(content) ?? "").toLowerCase()
  const sourceHints = ["指南", "source", "来源", "原文", "文档", "paper", "report", "白皮书"]
  const conceptHints = ["定义", "概念", "术语", "机制", "原则", "方法", "诊断", "治疗", "pathogenesis", "diagnosis", "treatment"]
  const entityHints = ["患者", "人群", "组织", "医院", "公司", "机构", "人名", "组织名", "organization", "company"]

  if (sourceHints.some((k) => lower.includes(k) || heading.includes(k))) return "source"
  if (entityHints.some((k) => lower.includes(k) || heading.includes(k))) return "entity"
  if (conceptHints.some((k) => lower.includes(k) || heading.includes(k))) return "concept"

  return "concept"
}

function folderFromType(type: string): string {
  switch (type) {
    case "source":
      return "sources"
    case "entity":
      return "entities"
    case "comparison":
      return "comparisons"
    case "query":
      return "queries"
    case "synthesis":
      return "synthesis"
    case "overview":
      return ""
    case "concept":
    default:
      return "concepts"
  }
}

function inferType(path: string, content: string): string {
  const frontmatter = extractFrontmatterBlock(content)
  const fromFrontmatter = extractFrontmatterField(frontmatter, "type")?.toLowerCase()
  if (fromFrontmatter && ALLOWED_TYPES.has(fromFrontmatter)) return fromFrontmatter
  return inferTypeFromText(path, content)
}

function rewriteGeneratedPath(path: string, content: string): string {
  if (RESERVED_WIKI_PATHS.has(path)) return path

  const type = inferType(path, content)
  const folder = folderFromType(type)
  if (!folder) return "wiki/overview.md"

  const pathParts = path.split("/")
  const maybeFolder = pathParts[1] ?? ""
  const fileName = pathParts[pathParts.length - 1] ?? "untitled.md"
  const frontmatter = extractFrontmatterBlock(content)
  const title = extractFrontmatterField(frontmatter, "title") ?? extractHeadingTitle(content) ?? fileName
  const slug = slugifyFileName(title)

  // Keep path if it is already in a structured folder.
  if (STRUCTURED_DIRS.has(maybeFolder)) {
    return `wiki/${maybeFolder}/${slug}.md`
  }

  return `wiki/${folder}/${slug}.md`
}

function normalizeGeneratedContent(path: string, content: string, sourceFileName: string): string {
  if (path === "wiki/log.md" || path === "wiki/index.md") return normalizeInternalLinks(content)
  if (path === "wiki/overview.md") return normalizeInternalLinks(content)

  const frontmatter = extractFrontmatterBlock(content)
  let body = stripFrontmatter(content).trim()
  body = unwrapOuterMarkdownFence(body)
  body = stripTemplatedFencedFrontmatter(body).trim()
  const date = new Date().toISOString().slice(0, 10)

  const type = inferType(path, content)
  const titleFromFm = extractFrontmatterField(frontmatter, "title")
  const titleFromHeading = extractHeadingTitle(body)
  const fileName = path.split("/").pop()?.replace(/\.md$/i, "") ?? "untitled"
  const title = titleFromFm ?? titleFromHeading ?? fileName.replace(/-/g, " ")

  const created = extractFrontmatterField(frontmatter, "created") ?? date
  const updated = date
  const tags = parseYamlArray(frontmatter, "tags")
  const related = parseYamlArray(frontmatter, "related").map((item) => normalizeWikilinkTarget(item) ?? item)
  const aliases = parseYamlArray(frontmatter, "aliases")
  const sources = uniq([...parseYamlArray(frontmatter, "sources"), sourceFileName])

  const fmLines = [
    "---",
    `type: ${type === "overview" ? "concept" : type}`,
    `title: "${escapeYaml(title)}"`,
    `created: ${created}`,
    `updated: ${updated}`,
    `tags: ${toInlineYamlList(tags)}`,
    `related: ${toInlineYamlList(related)}`,
    `sources: ${toInlineYamlList(sources)}`,
  ]

  if (aliases.length > 0) {
    fmLines.push(`aliases: ${toInlineYamlList(aliases)}`)
  }

  fmLines.push("---", "")
  const normalizedBody = normalizeInternalLinks(body)
  const ensuredBody = normalizedBody.trim().startsWith("#")
    ? normalizedBody.trim()
    : `# ${title}\n\n${normalizedBody.trim()}`

  return [...fmLines, ensuredBody, ""].join("\n")
}


function getStore() {
  return useChatStore.getState()
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

async function readFileWithExistence(path: string): Promise<{ exists: boolean; content: string }> {
  try {
    return { exists: true, content: await readFile(path) }
  } catch {
    return { exists: false, content: "" }
  }
}

async function readSourceText(sourcePath: string): Promise<string> {
  const primary = await tryReadFile(sourcePath)
  if (primary.trim().length >= MIN_SOURCE_CONTENT_CHARS) return primary

  const normalized = normalizePath(sourcePath)
  const fileName = getFileName(normalized)
  const sourceDir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : normalized
  const cachePath = `${sourceDir}/.cache/${fileName}.txt`
  const cached = await tryReadFile(cachePath)
  if (cached.trim().length >= MIN_SOURCE_CONTENT_CHARS) return cached

  return primary
}

function isMarkdownWikiPage(relativePath: string): boolean {
  return relativePath.startsWith("wiki/") && relativePath.endsWith(".md")
}

async function evaluateIngestQuality(
  projectPath: string,
  writtenPaths: string[],
  repairStats: AutoLinkRepairStats,
): Promise<string[]> {
  const issues: string[] = []
  const stubSet = new Set(repairStats.stubPaths)
  const pages = writtenPaths.filter((p) => isMarkdownWikiPage(p) && !RESERVED_WIKI_PATHS.has(p))
  const nonStubPages = pages.filter((p) => !stubSet.has(p))

  if (pages.length === 0) {
    issues.push("no wiki pages generated")
    return issues
  }

  if (
    repairStats.stubsCreated >= 3 &&
    repairStats.stubsCreated >= Math.ceil(Math.max(nonStubPages.length, 1) * 0.8)
  ) {
    issues.push(`too many auto stubs (${repairStats.stubsCreated})`)
  }

  if (nonStubPages.length <= 1 && repairStats.stubsCreated > 0) {
    issues.push("main pages are too few while unresolved links are high")
  }

  let fencedFrontmatterPages = 0
  for (const relativePath of nonStubPages) {
    const fullPath = `${normalizePath(projectPath)}/${relativePath}`
    const content = await tryReadFile(fullPath)
    if (/```ya?ml\s*\n---[\s\S]{0,5000}?\n---/i.test(content)) {
      fencedFrontmatterPages += 1
    }
  }

  if (
    nonStubPages.length > 0 &&
    fencedFrontmatterPages >= Math.ceil(nonStubPages.length * 0.5)
  ) {
    issues.push(`templated fenced-frontmatter detected in ${fencedFrontmatterPages} page(s)`)
  }

  return issues
}

async function cleanupGeneratedStubs(projectPath: string, stubPaths: string[]): Promise<void> {
  for (const stubPath of stubPaths) {
    try {
      await deleteFile(`${normalizePath(projectPath)}/${stubPath}`)
    } catch {
      // non-critical
    }
  }
}

async function rollbackWrittenFiles(
  projectPath: string,
  rollbackEntries: WriteRollbackEntry[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  for (const entry of [...rollbackEntries].reverse()) {
    const fullPath = `${pp}/${entry.relativePath}`
    try {
      if (entry.existed) {
        await writeFile(fullPath, entry.previousContent)
      } else {
        await deleteFile(fullPath)
      }
    } catch {
      // non-critical
    }
  }
}

export async function startIngest(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const store = getStore()
  store.setMode("ingest")
  store.setIngestSource(sp)
  store.clearMessages()
  store.setStreaming(false)

  const [sourceContent, schema, purpose, index] = await Promise.all([
    readSourceText(sp),
    tryReadFile(`${pp}/wiki/schema.md`),
    tryReadFile(`${pp}/wiki/purpose.md`),
    tryReadFile(`${pp}/wiki/index.md`),
  ])

  const fileName = getFileName(sp)

  const systemPrompt = [
    "You are a knowledgeable assistant helping to build a wiki from source documents.",
    "",
    LANGUAGE_RULE,
    "",
    purpose ? `## Wiki Purpose\n${purpose}` : "",
    schema ? `## Wiki Schema\n${schema}` : "",
    index ? `## Current Wiki Index\n${index}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  const userMessage = [
    `I'm ingesting the following source file into my wiki: **${fileName}**`,
    "",
    "Please read it carefully and present the key takeaways, important concepts, and information that would be valuable to capture in the wiki. Highlight anything that relates to the wiki's purpose and schema.",
    "",
    "---",
    `**File: ${fileName}**`,
    "```",
    sourceContent || "(empty file)",
    "```",
  ].join("\n")

  store.addMessage("user", userMessage)
  store.setStreaming(true)

  let accumulated = ""

  await streamChat(
    llmConfig,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      onToken: (token) => {
        accumulated += token
        getStore().appendStreamToken(token)
      },
      onDone: () => {
        getStore().finalizeStream(accumulated)
      },
      onError: (err) => {
        getStore().finalizeStream(`Error during ingest: ${err.message}`)
      },
    },
    signal,
  )
}

export async function executeIngestWrites(
  projectPath: string,
  llmConfig: LlmConfig,
  userGuidance?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const store = getStore()

  const [schema, index] = await Promise.all([
    tryReadFile(`${pp}/wiki/schema.md`),
    tryReadFile(`${pp}/wiki/index.md`),
  ])

  const conversationHistory = store.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

  const writePrompt = [
    "Based on our discussion, please generate the wiki files that should be created or updated.",
    "",
    userGuidance ? `Additional guidance: ${userGuidance}` : "",
    "",
    schema ? `## Wiki Schema\n${schema}` : "",
    index ? `## Current Wiki Index\n${index}` : "",
    "",
    "Output ONLY the file contents in this exact format for each file:",
    "```",
    "---FILE: wiki/path/to/file.md---",
    "(file content here)",
    "---END FILE---",
    "```",
    "",
    "For wiki/log.md, include a log entry to append. For all other files, output the complete file content.",
    "Use relative paths from the project root (e.g., wiki/sources/topic.md).",
    "Do not include any other text outside the FILE blocks.",
  ]
    .filter((line) => line !== undefined)
    .join("\n")

  conversationHistory.push({ role: "user", content: writePrompt })

  store.addMessage("user", writePrompt)
  store.setStreaming(true)

  let accumulated = ""

  const systemPrompt = [
    "You are a wiki generation assistant. Your task is to produce structured wiki file contents.",
    "",
    LANGUAGE_RULE,
    schema ? `## Wiki Schema\n${schema}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  await streamChat(
    llmConfig,
    [{ role: "system", content: systemPrompt }, ...conversationHistory],
    {
      onToken: (token) => {
        accumulated += token
        getStore().appendStreamToken(token)
      },
      onDone: () => {
        getStore().finalizeStream(accumulated)
      },
      onError: (err) => {
        getStore().finalizeStream(`Error generating wiki files: ${err.message}`)
      },
    },
    signal,
  )

  const writtenPaths: string[] = []
  const matches = accumulated.matchAll(FILE_BLOCK_REGEX)
  const sourcePath = store.ingestSource
  const sourceFileName = sourcePath ? getFileName(sourcePath) : "manual-chat.md"

  for (const match of matches) {
    const rawPath = match[1].trim()
    const content = match[2]
    const safePath = normalizeGeneratedPath(rawPath)

    if (!safePath) continue
    const relativePath = rewriteGeneratedPath(safePath, content)
    const normalizedContent = normalizeGeneratedContent(relativePath, content, sourceFileName)

    const fullPath = `${pp}/${relativePath}`

    try {
      if (relativePath === "wiki/log.md" || relativePath.endsWith("/log.md")) {
        const existing = await tryReadFile(fullPath)
        const appended = existing
          ? `${existing}\n\n${normalizedContent.trim()}`
          : normalizedContent.trim()
        await writeFile(fullPath, appended)
      } else {
        await writeFile(fullPath, normalizedContent)
      }
      if (!writtenPaths.includes(fullPath)) writtenPaths.push(fullPath)
    } catch (err) {
      console.error(`Failed to write ${fullPath}:`, err)
    }
  }

  // Auto-repair links after chat-driven writes as well.
  let repairSummary = ""
  try {
    const stats = await autoRepairWikiLinks(pp, sourceFileName, {
      createStubs: false,
      replaceUnresolvedWithText: false,
    })
    for (const path of stats.stubPaths) {
      const full = `${pp}/${path}`
      if (!writtenPaths.includes(full)) writtenPaths.push(full)
    }
    for (const path of stats.rewrittenFiles) {
      const full = `${pp}/wiki/${path}`
      if (!writtenPaths.includes(full)) writtenPaths.push(full)
    }
    if (stats.linksRewritten > 0 || stats.stubsCreated > 0) {
      repairSummary = `\nAuto-repair: ${stats.linksRewritten} links fixed, ${stats.stubsCreated} stubs created.`
    }
    try {
      const graph = await mergeLiteGraphFromIngest(
        pp,
        writtenPaths.map((full) => full.replace(`${pp}/`, "")),
        sourceFileName,
        stats.unresolved,
      )
      const candidateCount = graph.edges.filter((e) => e.status === "candidate").length
      const relatedSync = await syncRelatedFromLiteGraph(
        pp,
        writtenPaths.map((full) => full.replace(`${pp}/`, "")),
      )
      repairSummary += `\nLight graph synced: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${candidateCount} candidate edges.`
      if (relatedSync.pagesUpdated > 0) {
        repairSummary += `\nRelated synced: ${relatedSync.pagesUpdated} page(s), ${relatedSync.relatedInjected} related links.`
      }
    } catch {
      // non-critical
    }
  } catch {
    // non-critical
  }

  if (writtenPaths.length > 0) {
    const fileList = writtenPaths.map((p) => `- ${p}`).join("\n")
    getStore().addMessage("system", `Files written to wiki:\n${fileList}${repairSummary}`)
  } else {
    getStore().addMessage("system", "No files were written. The LLM response did not contain valid FILE blocks.")
  }

  return writtenPaths
}
