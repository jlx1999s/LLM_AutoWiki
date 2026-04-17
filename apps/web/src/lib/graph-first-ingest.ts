import { getFileName } from "@/lib/path-utils"

export type StructuredNodeKind = "entity" | "concept"

export interface StructuredNode {
  key: string
  name: string
  kind: StructuredNodeKind
  aliases: string[]
  summary: string
  evidence: string[]
}

export interface StructuredEdge {
  sourceKey: string
  targetKey: string
  sourceName: string
  targetName: string
  relation: string
  confidence: number
  evidence: string
}

export interface StructuredExtraction {
  sourceTitle: string
  sourceSummary: string
  sourceTags: string[]
  sourceHighlights: string[]
  nodes: StructuredNode[]
  edges: StructuredEdge[]
  unresolved: string[]
  openQuestions: string[]
}

export interface CompiledWikiFile {
  path: string
  content: string
}

export interface CompiledWikiResult {
  files: CompiledWikiFile[]
  sourcePath: string
  unresolved: string[]
  openQuestions: string[]
  stats: {
    nodeCount: number
    edgeCount: number
    entityCount: number
    conceptCount: number
  }
}

export interface StructuredCandidateNode {
  name: string
  kindHint?: string
  aliases: string[]
  summary: string
  evidence: string[]
}

export interface StructuredCandidateEdge {
  source: string
  target: string
  relation: string
  confidence: number
  evidence: string
}

export interface StructuredExtractionCandidate {
  sourceTitle: string
  sourceSummary: string
  sourceTags: string[]
  sourceHighlights: string[]
  openQuestions: string[]
  unresolved: string[]
  nodes: StructuredCandidateNode[]
  edges: StructuredCandidateEdge[]
}

export type StructuredGraphIssueSeverity = "error" | "warning"

export interface StructuredGraphQualityIssue {
  code: string
  severity: StructuredGraphIssueSeverity
  message: string
}

export interface StructuredGraphQualityReport {
  issues: StructuredGraphQualityIssue[]
  metrics: {
    nodeCount: number
    edgeCount: number
    associatedEdgeCount: number
    associatedEdgeRatio: number
    isolatedNodeCount: number
    isolatedNodeRatio: number
    entityCount: number
    conceptCount: number
  }
}

type CanonicalRelation =
  | "causes"
  | "treats"
  | "diagnoses_treats"
  | "complication_of"
  | "sequela_of"
  | "may_progress_to"
  | "associated_with"

type SemanticClass =
  | "pathogen"
  | "drug"
  | "procedure"
  | "disease"
  | "complication"
  | "severity_stage"
  | "organization"
  | "other"

function uniq(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeKey(value: string): string {
  const normalized = normalizeWhitespace(value)
  const ascii = /^[\x00-\x7F]+$/.test(normalized)
  return ascii ? normalized.toLowerCase() : normalized
}

function cjkCount(text: string): number {
  const match = text.match(/[\u3400-\u9fff]/g)
  return match ? match.length : 0
}

function likelyCjk(text: string): boolean {
  const letters = text.replace(/\s/g, "")
  if (!letters) return false
  return cjkCount(letters) / letters.length >= 0.25
}

function inferNodeKind(kindHint: string | undefined, name: string, summary: string): StructuredNodeKind {
  const raw = (kindHint ?? "").toLowerCase()
  const text = `${name} ${summary}`.toLowerCase()

  if (
    /病原体|pathogen|mycoplasma|病毒|细菌|支原体/.test(text) &&
    !/肺炎支原体肺炎|mycoplasma pneumoniae pneumonia/.test(text)
  ) {
    return "entity"
  }

  const conceptMedicalHints = [
    "肺炎",
    "感染",
    "综合征",
    "并发症",
    "后遗症",
    "治疗",
    "诊疗",
    "分型",
    "重症",
    "危重",
    "轻症",
    "证",
    "disease",
    "infection",
    "syndrome",
    "guideline",
    "classification",
    "severe",
    "critical",
  ]
  if (conceptMedicalHints.some((hint) => text.includes(hint.toLowerCase()))) {
    return "concept"
  }

  if (/(entity|person|org|organization|institution|company|agent|pathogen|drug|virus|bacteria)/.test(raw)) {
    return "entity"
  }
  if (/(concept|topic|disease|method|principle|diagnosis|treatment|guideline|procedure)/.test(raw)) {
    return "concept"
  }

  const entityHints = [
    "医院",
    "大学",
    "委员会",
    "中心",
    "机构",
    "集团",
    "公司",
    "研究所",
    "pathogen",
    "virus",
    "bacteria",
    "drug",
    "organization",
    "hospital",
    "university",
    "committee",
    "center",
    "department",
  ]
  if (entityHints.some((hint) => text.includes(hint.toLowerCase()))) {
    return "entity"
  }

  return "concept"
}

function canonicalizeRelation(value: string | undefined): CanonicalRelation {
  const raw = normalizeWhitespace(value ?? "")
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()

  if (!cleaned) return "associated_with"

  if ([
    "causes",
    "cause",
    "lead_to",
    "leads_to",
    "pathogenesis_of",
    "病原体",
    "致病",
  ].includes(cleaned)) return "causes"

  if ([
    "treats",
    "treat",
    "therapy_for",
    "used_for",
    "治疗",
    "用药",
    "intervenes",
  ].includes(cleaned)) return "treats"

  if ([
    "diagnoses_treats",
    "diagnose_and_treat",
    "diagnosed_by",
    "managed_by",
    "介入治疗",
  ].includes(cleaned)) return "diagnoses_treats"

  if ([
    "complication_of",
    "并发症_of",
    "并发于",
  ].includes(cleaned)) return "complication_of"

  if ([
    "sequela_of",
    "后遗症_of",
    "后遗症",
  ].includes(cleaned)) return "sequela_of"

  if ([
    "may_progress_to",
    "progress_to",
    "may_develop_to",
    "进展为",
    "发展为",
  ].includes(cleaned)) return "may_progress_to"

  return "associated_with"
}

function inferSemanticClass(node: StructuredNode): SemanticClass {
  const text = normalizeWhitespace([node.name, node.summary, ...node.aliases].join(" ")).toLowerCase()

  const has = (patterns: string[]) => patterns.some((p) => text.includes(p))
  const pathogenHints = ["病原体", "支原体", "virus", "bacteria", "pathogen", "mycoplasma"]
  const drugHints = ["药物", "抗菌药", "抗生素", "激素", "immunoglobulin", "quinolone", "macrolide", "tetracycline"]
  const procedureHints = ["支气管镜", "镜", "检查", "介入", "bronchoscopy", "procedure"]
  const severityHints = ["轻症", "重症", "危重", "暴发", "fulminant", "severe", "critical"]
  const complicationHints = ["并发症", "后遗症", "栓塞", "坏死", "闭塞", "塑形", "embolism", "necrotizing", "sequela"]
  const diseaseHints = ["肺炎", "感染", "综合征", "炎", "disease", "infection", "pneumonia"]
  const orgHints = ["医院", "大学", "委员会", "中心", "机构", "organization", "hospital", "university", "committee"]

  if (node.kind === "concept") {
    if (has(severityHints) && has(diseaseHints)) return "severity_stage"
    if (has(complicationHints)) return "complication"
    if (has(drugHints)) return "drug"
    if (has(diseaseHints)) return "disease"
    if (has(pathogenHints) && text.includes("病原体")) return "pathogen"
  }

  if (has(severityHints) && has(diseaseHints)) return "severity_stage"
  if (has(complicationHints)) return "complication"
  if (has(diseaseHints) && !text.includes("病原体")) return "disease"
  if (has(drugHints)) return "drug"
  if (has(procedureHints)) return "procedure"
  if (has(pathogenHints) && (text.includes("病原体") || !has(diseaseHints))) return "pathogen"
  if (has(orgHints)) return "organization"
  return "other"
}

function severityScore(node: StructuredNode): number {
  const text = normalizeWhitespace([node.name, node.summary].join(" ")).toLowerCase()
  if (/(危重|暴发|critical|fulminant)/.test(text)) return 4
  if (/(重症|severe)/.test(text)) return 3
  if (/(轻症|mild)/.test(text)) return 1
  return 2
}

function relationAllowed(relation: CanonicalRelation, sourceClass: SemanticClass, targetClass: SemanticClass): boolean {
  switch (relation) {
    case "causes":
      return ["pathogen", "disease", "other"].includes(sourceClass) && ["disease", "complication", "severity_stage"].includes(targetClass)
    case "treats":
      return ["drug", "procedure", "other"].includes(sourceClass) && ["disease", "complication", "severity_stage"].includes(targetClass)
    case "diagnoses_treats":
      return ["procedure", "drug", "other"].includes(sourceClass) && ["disease", "complication", "severity_stage"].includes(targetClass)
    case "complication_of":
    case "sequela_of":
      return ["complication", "disease", "severity_stage"].includes(sourceClass) && ["disease", "severity_stage"].includes(targetClass)
    case "may_progress_to":
      return ["disease", "severity_stage", "complication"].includes(sourceClass) && ["disease", "severity_stage", "complication"].includes(targetClass)
    case "associated_with":
      return true
    default:
      return false
  }
}

function normalizeEdgeSemantics(
  edge: StructuredEdge,
  nodesByKey: Map<string, StructuredNode>,
): StructuredEdge | null {
  const sourceNode = nodesByKey.get(edge.sourceKey)
  const targetNode = nodesByKey.get(edge.targetKey)
  if (!sourceNode || !targetNode) return null

  let relation: CanonicalRelation = canonicalizeRelation(edge.relation)
  let sourceKey = edge.sourceKey
  let targetKey = edge.targetKey
  let sourceName = edge.sourceName
  let targetName = edge.targetName

  let sourceClass = inferSemanticClass(sourceNode)
  let targetClass = inferSemanticClass(targetNode)

  const reverseAllowed = relationAllowed(relation, targetClass, sourceClass)
  const forwardAllowed = relationAllowed(relation, sourceClass, targetClass)

  if (!forwardAllowed && reverseAllowed) {
    sourceKey = edge.targetKey
    targetKey = edge.sourceKey
    sourceName = edge.targetName
    targetName = edge.sourceName
    const swappedSource = nodesByKey.get(sourceKey)
    const swappedTarget = nodesByKey.get(targetKey)
    sourceClass = swappedSource ? inferSemanticClass(swappedSource) : sourceClass
    targetClass = swappedTarget ? inferSemanticClass(swappedTarget) : targetClass
  }

  if (relation === "may_progress_to") {
    const srcNode = nodesByKey.get(sourceKey)
    const dstNode = nodesByKey.get(targetKey)
    if (srcNode && dstNode) {
      const srcScore = severityScore(srcNode)
      const dstScore = severityScore(dstNode)
      if (srcScore > dstScore) {
        const prevSourceKey = sourceKey
        const prevSourceName = sourceName
        sourceKey = targetKey
        targetKey = prevSourceKey
        sourceName = targetName
        targetName = prevSourceName
      }
      if (srcScore === dstScore) {
        relation = "associated_with"
      }
    }
  }

  const finalSourceNode = nodesByKey.get(sourceKey)
  const finalTargetNode = nodesByKey.get(targetKey)
  const finalSourceClass = finalSourceNode ? inferSemanticClass(finalSourceNode) : sourceClass
  const finalTargetClass = finalTargetNode ? inferSemanticClass(finalTargetNode) : targetClass

  if (!relationAllowed(relation, finalSourceClass, finalTargetClass)) {
    relation = "associated_with"
  }

  const confidence = clampConfidence(edge.confidence)
  const normalizedConfidence =
    relation === "associated_with"
      ? Math.min(confidence, 0.55)
      : Math.max(confidence, 0.6)

  if (relation === "associated_with" && normalizedConfidence < 0.75) {
    return null
  }

  return {
    sourceKey,
    targetKey,
    sourceName,
    targetName,
    relation,
    confidence: normalizedConfidence,
    evidence: edge.evidence,
  }
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0.6
  if (parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

function slugifyFileName(raw: string): string {
  const base = raw
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  const normalized = base.replace(/[A-Z]/g, (m) => m.toLowerCase())
  return normalized || "untitled"
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function toInlineYamlList(values: string[]): string {
  return `[${values.map((v) => `"${escapeYaml(v)}"`).join(", ")}]`
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim()
  const direct = trimmed.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i)
  return direct?.[1]?.trim() ?? trimmed
}

function extractJsonCandidates(raw: string): string[] {
  const candidates: string[] = []
  const stripped = stripMarkdownFence(raw)
  if (stripped) candidates.push(stripped)

  const fenceRegex = /```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/gi
  let fenceMatch: RegExpExecArray | null
  while ((fenceMatch = fenceRegex.exec(raw)) !== null) {
    const candidate = fenceMatch[1]?.trim()
    if (candidate) candidates.push(candidate)
  }

  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1))
  }

  return uniq(candidates)
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const candidates = extractJsonCandidates(raw)
  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .trim()
    try {
      const parsed = JSON.parse(normalized)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error("Structured extraction is not valid JSON")
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(value)
  if (typeof value === "number") return String(value)
  return ""
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniq(value.map((item) => asString(item)).filter(Boolean))
  }
  const single = asString(value)
  return single ? [single] : []
}

function collectNodeInputs(root: Record<string, unknown>): StructuredCandidateNode[] {
  const nodes: StructuredCandidateNode[] = []

  const pushNode = (raw: unknown, forcedKind?: string) => {
    const obj = asObject(raw)
    if (!obj) return
    const name = asString(obj.name ?? obj.title ?? obj.term ?? obj.id)
    if (!name) return
    const summary = asString(obj.summary ?? obj.description ?? obj.definition)
    const aliases = [
      ...asStringArray(obj.aliases),
      ...asStringArray(obj.synonyms),
      ...asStringArray(obj.alias),
    ]
    const evidence = [
      ...asStringArray(obj.evidence),
      ...asStringArray(obj.quotes),
      ...asStringArray(obj.support),
    ]
    nodes.push({
      name,
      kindHint: forcedKind ?? asString(obj.kind ?? obj.type ?? obj.category),
      aliases,
      summary: summary ?? "",
      evidence,
    })
  }

  const fromNodes = root.nodes
  if (Array.isArray(fromNodes)) fromNodes.forEach((item) => pushNode(item))

  const entities = root.entities
  if (Array.isArray(entities)) entities.forEach((item) => pushNode(item, "entity"))

  const concepts = root.concepts
  if (Array.isArray(concepts)) concepts.forEach((item) => pushNode(item, "concept"))

  return nodes
}

function collectEdgeInputs(root: Record<string, unknown>): StructuredCandidateEdge[] {
  const out: StructuredCandidateEdge[] = []
  const relationBuckets = [root.edges, root.relations, root.triples]
  for (const bucket of relationBuckets) {
    if (!Array.isArray(bucket)) continue
    for (const item of bucket) {
      const obj = asObject(item)
      if (!obj) continue
      const source = asString(obj.source ?? obj.from ?? obj.head ?? obj.subject ?? obj.s)
      const target = asString(obj.target ?? obj.to ?? obj.tail ?? obj.object ?? obj.o)
      if (!source || !target) continue
      out.push({
        source,
        target,
        relation: asString(obj.relation ?? obj.predicate ?? obj.type ?? obj.p),
        confidence: clampConfidence(obj.confidence ?? obj.score),
        evidence: asString(obj.evidence ?? obj.quote ?? obj.snippet),
      })
    }
  }
  return out
}

function findMentionIndex(text: string, term: string): number {
  if (!term) return -1
  if (likelyCjk(term)) return text.indexOf(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(^|[^A-Za-z0-9])(${escaped})(?=[^A-Za-z0-9]|$)`, "i")
  const match = regex.exec(text)
  if (!match) return -1
  const prefixLen = match[1]?.length ?? 0
  return match.index + prefixLen
}

function inferEdgesFromMentions(nodes: StructuredNode[]): StructuredEdge[] {
  const inferred: StructuredEdge[] = []
  const seen = new Set<string>()

  for (const source of nodes) {
    const text = normalizeWhitespace([source.summary, ...source.evidence].join(" "))
    if (!text) continue
    for (const target of nodes) {
      if (target.key === source.key) continue
      const aliases = uniq([target.name, ...target.aliases]).sort((a, b) => b.length - a.length)
      const hit = aliases.find((alias) => findMentionIndex(text, alias) >= 0)
      if (!hit) continue
      const edgeKey = `${source.key}:::associated_with:::${target.key}`
      if (seen.has(edgeKey)) continue
      seen.add(edgeKey)
      inferred.push({
        sourceKey: source.key,
        targetKey: target.key,
        sourceName: source.name,
        targetName: target.name,
        relation: "associated_with",
        confidence: 0.45,
        evidence: `Mention inferred from "${source.name}" summary`,
      })
    }
  }

  return inferred
}

export function parseStructuredExtractionResponse(raw: string, sourceFileName: string): StructuredExtraction {
  const candidate = parseStructuredExtractionCandidate(raw, sourceFileName)
  return normalizeStructuredExtraction(candidate)
}

export function parseStructuredExtractionCandidate(raw: string, sourceFileName: string): StructuredExtractionCandidate {
  const root = parseJsonObject(raw)
  const fileBase = getFileName(sourceFileName).replace(/\.[^.]+$/, "")

  const sourceObj = asObject(root.source) ?? {}
  const sourceTitle = asString(sourceObj.title ?? root.source_title ?? root.title) || fileBase
  const sourceSummary =
    asString(sourceObj.summary ?? sourceObj.abstract ?? root.summary) || "Structured extraction completed."
  const sourceTags = uniq([
    ...asStringArray(sourceObj.tags),
    ...asStringArray(root.tags),
  ])
  const sourceHighlights = uniq([
    ...asStringArray(sourceObj.highlights),
    ...asStringArray(root.highlights),
    ...asStringArray(root.key_points),
  ])
  const openQuestions = uniq([
    ...asStringArray(root.open_questions),
    ...asStringArray(root.questions),
  ])

  const unresolved = uniq([
    ...asStringArray(root.unresolved),
    ...asStringArray(root.unresolved_entities),
    ...asStringArray(root.unresolved_nodes),
  ])

  return {
    sourceTitle,
    sourceSummary,
    sourceTags,
    sourceHighlights,
    openQuestions,
    unresolved,
    nodes: collectNodeInputs(root),
    edges: collectEdgeInputs(root),
  }
}

export function normalizeStructuredExtraction(candidate: StructuredExtractionCandidate): StructuredExtraction {
  const nodeInputs = candidate.nodes
  const nodesByKey = new Map<string, StructuredNode>()
  const aliasToNodeKey = new Map<string, string>()

  const registerAlias = (alias: string, nodeKey: string) => {
    const normalized = normalizeKey(alias)
    if (!normalized) return
    if (!aliasToNodeKey.has(normalized)) {
      aliasToNodeKey.set(normalized, nodeKey)
    }
  }

  for (const input of nodeInputs) {
    const cleanName = normalizeWhitespace(input.name)
    if (!cleanName) continue
    const key = normalizeKey(cleanName)
    if (!key) continue
    const summary = normalizeWhitespace(input.summary)
    const kind = inferNodeKind(input.kindHint, cleanName, summary)
    const aliases = uniq([cleanName, ...input.aliases].map(normalizeWhitespace).filter(Boolean))
    const evidence = uniq(input.evidence.map(normalizeWhitespace).filter(Boolean)).slice(0, 10)

    const existing = nodesByKey.get(key)
    if (existing) {
      existing.aliases = uniq([...existing.aliases, ...aliases])
      existing.evidence = uniq([...existing.evidence, ...evidence]).slice(0, 10)
      if (!existing.summary && summary) existing.summary = summary
      continue
    }

    nodesByKey.set(key, {
      key,
      name: cleanName,
      kind,
      aliases,
      summary,
      evidence,
    })
  }

  for (const node of nodesByKey.values()) {
    for (const alias of uniq([node.name, ...node.aliases])) {
      registerAlias(alias, node.key)
    }
  }

  const unresolved: string[] = []
  const edgeInputs = candidate.edges
  const edgesByKey = new Map<string, StructuredEdge>()

  const resolveNodeKey = (value: string): string | null => {
    const direct = normalizeKey(value)
    if (!direct) return null
    return aliasToNodeKey.get(direct) ?? (nodesByKey.has(direct) ? direct : null)
  }

  const pushUnresolved = (value: string) => {
    const normalized = normalizeWhitespace(value)
    if (!normalized) return
    unresolved.push(normalized)
  }

  for (const edge of edgeInputs) {
    const sourceKey = resolveNodeKey(edge.source)
    const targetKey = resolveNodeKey(edge.target)
    if (!sourceKey || !targetKey) {
      if (!sourceKey) pushUnresolved(edge.source)
      if (!targetKey) pushUnresolved(edge.target)
      continue
    }
    if (sourceKey === targetKey) continue
    const sourceNode = nodesByKey.get(sourceKey)
    const targetNode = nodesByKey.get(targetKey)
    if (!sourceNode || !targetNode) continue

    const confidence = clampConfidence(edge.confidence)
    const evidence = normalizeWhitespace(edge.evidence ?? "")
    const relation = canonicalizeRelation(edge.relation)
    const key = `${sourceKey}:::${relation}:::${targetKey}`
    const existing = edgesByKey.get(key)
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence)
      if (!existing.evidence && evidence) existing.evidence = evidence
      continue
    }
    edgesByKey.set(key, {
      sourceKey,
      targetKey,
      sourceName: sourceNode.name,
      targetName: targetNode.name,
      relation,
      confidence,
      evidence,
    })
  }

  const nodes = Array.from(nodesByKey.values())
  if (nodes.length === 0) {
    throw new Error("Structured extraction returned zero nodes")
  }

  const inferredEdges = inferEdgesFromMentions(nodes).filter((edge) => edge.sourceKey !== edge.targetKey)
  for (const inferred of inferredEdges) {
    const key = `${inferred.sourceKey}:::${inferred.relation}:::${inferred.targetKey}`
    if (!edgesByKey.has(key)) {
      edgesByKey.set(key, inferred)
    }
  }

  const dedupUnresolved = uniq([...candidate.unresolved, ...unresolved])
  const semanticEdges: StructuredEdge[] = []
  for (const edge of edgesByKey.values()) {
    const normalized = normalizeEdgeSemantics(edge, nodesByKey)
    if (!normalized) continue
    semanticEdges.push(normalized)
  }

  const directionalRelations = new Set<CanonicalRelation>([
    "causes",
    "treats",
    "diagnoses_treats",
    "complication_of",
    "sequela_of",
    "may_progress_to",
  ])

  const edgeByKey = new Map<string, StructuredEdge>()
  for (const edge of semanticEdges) {
    const key = `${edge.sourceKey}:::${edge.relation}:::${edge.targetKey}`
    const existing = edgeByKey.get(key)
    if (!existing || edge.confidence > existing.confidence) {
      edgeByKey.set(key, edge)
    }
  }

  for (const edge of [...edgeByKey.values()]) {
    if (!directionalRelations.has(edge.relation as CanonicalRelation)) continue
    const reverseKey = `${edge.targetKey}:::${edge.relation}:::${edge.sourceKey}`
    const reverse = edgeByKey.get(reverseKey)
    if (!reverse) continue

    const sourceNode = nodesByKey.get(edge.sourceKey)
    const targetNode = nodesByKey.get(edge.targetKey)
    const revSourceNode = nodesByKey.get(reverse.sourceKey)
    const revTargetNode = nodesByKey.get(reverse.targetKey)

    let keepForward = edge.confidence >= reverse.confidence
    if (edge.relation === "may_progress_to" && sourceNode && targetNode && revSourceNode && revTargetNode) {
      const forwardDelta = severityScore(targetNode) - severityScore(sourceNode)
      const reverseDelta = severityScore(revTargetNode) - severityScore(revSourceNode)
      keepForward = forwardDelta >= reverseDelta
    }
    if ((edge.relation === "complication_of" || edge.relation === "sequela_of") && sourceNode && targetNode && revSourceNode && revTargetNode) {
      const forwardScore =
        (inferSemanticClass(sourceNode) === "complication" ? 1 : 0) +
        (inferSemanticClass(targetNode) !== "complication" ? 1 : 0)
      const reverseScore =
        (inferSemanticClass(revSourceNode) === "complication" ? 1 : 0) +
        (inferSemanticClass(revTargetNode) !== "complication" ? 1 : 0)
      keepForward = forwardScore >= reverseScore
    }

    if (keepForward) {
      edgeByKey.delete(reverseKey)
    } else {
      edgeByKey.delete(`${edge.sourceKey}:::${edge.relation}:::${edge.targetKey}`)
    }
  }

  // Keep semantic graph concise and avoid noisy fully-connected outputs.
  const maxEdges = Math.max(20, nodes.length * 4)
  const ranked = Array.from(edgeByKey.values())
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      if (a.relation === "associated_with" && b.relation !== "associated_with") return 1
      if (b.relation === "associated_with" && a.relation !== "associated_with") return -1
      if (a.relation !== b.relation) return a.relation.localeCompare(b.relation)
      return a.targetName.localeCompare(b.targetName)
    })
    .slice(0, maxEdges)

  return {
    sourceTitle: candidate.sourceTitle,
    sourceSummary: candidate.sourceSummary,
    sourceTags: candidate.sourceTags,
    sourceHighlights: candidate.sourceHighlights,
    nodes,
    edges: ranked,
    unresolved: dedupUnresolved,
    openQuestions: candidate.openQuestions,
  }
}

export function runStructuredGraphQualityGate(extraction: StructuredExtraction): StructuredGraphQualityReport {
  const nodeCount = extraction.nodes.length
  const edgeCount = extraction.edges.length
  const associatedEdgeCount = extraction.edges.filter((edge) => edge.relation === "associated_with").length
  const associatedEdgeRatio = edgeCount > 0 ? associatedEdgeCount / edgeCount : 0
  const entityCount = extraction.nodes.filter((node) => node.kind === "entity").length
  const conceptCount = extraction.nodes.filter((node) => node.kind === "concept").length

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const node of extraction.nodes) {
    inDegree.set(node.key, 0)
    outDegree.set(node.key, 0)
  }
  for (const edge of extraction.edges) {
    outDegree.set(edge.sourceKey, (outDegree.get(edge.sourceKey) ?? 0) + 1)
    inDegree.set(edge.targetKey, (inDegree.get(edge.targetKey) ?? 0) + 1)
  }
  const isolatedNodeCount = extraction.nodes.filter((node) => {
    const inN = inDegree.get(node.key) ?? 0
    const outN = outDegree.get(node.key) ?? 0
    return inN + outN === 0
  }).length
  const isolatedNodeRatio = nodeCount > 0 ? isolatedNodeCount / nodeCount : 0

  const issues: StructuredGraphQualityIssue[] = []
  const pushIssue = (code: string, severity: StructuredGraphIssueSeverity, message: string) => {
    issues.push({ code, severity, message })
  }

  if (nodeCount < 2) {
    pushIssue("too_few_nodes", "error", "Structured extraction returned too few nodes")
  }
  if (edgeCount === 0 && nodeCount >= 4) {
    pushIssue("no_edges", "error", "Structured graph has no semantic edges")
  }
  if (edgeCount > 0 && associatedEdgeRatio >= 0.85 && edgeCount >= 6) {
    pushIssue("too_many_associated_edges", "error", "Most edges degraded to associated_with; semantic specificity is too low")
  }
  if (isolatedNodeRatio >= 0.7 && nodeCount >= 8) {
    pushIssue("too_many_isolated_nodes", "warning", "Most nodes are isolated from the graph")
  }
  if (nodeCount >= 8 && (entityCount === 0 || conceptCount === 0)) {
    pushIssue("single_kind_collapse", "warning", "All nodes collapsed into one kind (entity/concept)")
  }

  return {
    issues,
    metrics: {
      nodeCount,
      edgeCount,
      associatedEdgeCount,
      associatedEdgeRatio,
      isolatedNodeCount,
      isolatedNodeRatio,
      entityCount,
      conceptCount,
    },
  }
}

function buildFrontmatter(input: {
  type: string
  title: string
  date: string
  tags: string[]
  related: string[]
  sources: string[]
  aliases?: string[]
}): string {
  const lines = [
    "---",
    `type: ${input.type}`,
    `title: "${escapeYaml(input.title)}"`,
    `created: ${input.date}`,
    `updated: ${input.date}`,
    `tags: ${toInlineYamlList(input.tags)}`,
    `related: ${toInlineYamlList(input.related)}`,
    `sources: ${toInlineYamlList(input.sources)}`,
  ]
  if (input.aliases && input.aliases.length > 0) {
    lines.push(`aliases: ${toInlineYamlList(input.aliases)}`)
  }
  lines.push("---", "")
  return lines.join("\n")
}

function linkLine(targetPath: string, targetName: string): string {
  return `[[${targetPath}|${targetName}]]`
}

export function compileStructuredGraphToWiki(
  extraction: StructuredExtraction,
  sourceFileName: string,
  dateIso = new Date().toISOString().slice(0, 10),
): CompiledWikiResult {
  const sourceBase = getFileName(sourceFileName).replace(/\.[^.]+$/, "")
  const sourceSlug = slugifyFileName(sourceBase)
  const sourceKey = `sources/${sourceSlug}`
  const sourcePath = `wiki/sources/${sourceSlug}.md`
  const cjkMode = likelyCjk(`${extraction.sourceTitle} ${extraction.sourceSummary}`)

  const headings = cjkMode
    ? {
        summary: "摘要",
        evidence: "证据",
        relations: "关系",
        entities: "实体",
        concepts: "概念",
        highlights: "要点",
        questions: "待确认问题",
      }
    : {
        summary: "Summary",
        evidence: "Evidence",
        relations: "Relations",
        entities: "Entities",
        concepts: "Concepts",
        highlights: "Highlights",
        questions: "Open Questions",
      }

  const nodePathByKey = new Map<string, string>()
  for (const node of extraction.nodes) {
    const folder = node.kind === "entity" ? "entities" : "concepts"
    nodePathByKey.set(node.key, `${folder}/${slugifyFileName(node.name)}`)
  }

  const relatedMap = new Map<string, Set<string>>()
  const relationLinesByNode = new Map<string, string[]>()
  const addRelated = (from: string, to: string) => {
    if (!from || !to || from === to) return
    const set = relatedMap.get(from) ?? new Set<string>()
    set.add(to)
    relatedMap.set(from, set)
  }

  for (const node of extraction.nodes) {
    const ownPath = nodePathByKey.get(node.key)
    if (!ownPath) continue
    addRelated(ownPath, sourceKey)
    addRelated(sourceKey, ownPath)
  }

  for (const edge of extraction.edges) {
    const sourcePathKey = nodePathByKey.get(edge.sourceKey)
    const targetPathKey = nodePathByKey.get(edge.targetKey)
    if (!sourcePathKey || !targetPathKey) continue
    addRelated(sourcePathKey, targetPathKey)
    addRelated(targetPathKey, sourcePathKey)

    const srcLines = relationLinesByNode.get(edge.sourceKey) ?? []
    srcLines.push(
      `- ${linkLine(targetPathKey, edge.targetName)} (${edge.relation}, ${(edge.confidence * 100).toFixed(0)}%)`,
    )
    relationLinesByNode.set(edge.sourceKey, srcLines)
  }

  const files: CompiledWikiFile[] = []

  const entityNodes = extraction.nodes.filter((node) => node.kind === "entity")
  const conceptNodes = extraction.nodes.filter((node) => node.kind === "concept")

  const sourceRelations = extraction.edges
    .map((edge) => {
      const srcPath = nodePathByKey.get(edge.sourceKey)
      const dstPath = nodePathByKey.get(edge.targetKey)
      if (!srcPath || !dstPath) return ""
      return `- ${linkLine(srcPath, edge.sourceName)} ${edge.relation} ${linkLine(dstPath, edge.targetName)}`
    })
    .filter(Boolean)
    .slice(0, 24)

  const sourceSections = [
    `# ${extraction.sourceTitle}`,
    "",
    `## ${headings.summary}`,
    extraction.sourceSummary || (cjkMode ? "自动抽取得到来源摘要。" : "Summary generated from structured extraction."),
    "",
  ]

  if (extraction.sourceHighlights.length > 0) {
    sourceSections.push(`## ${headings.highlights}`)
    sourceSections.push(...extraction.sourceHighlights.slice(0, 12).map((item) => `- ${item}`))
    sourceSections.push("")
  }

  if (entityNodes.length > 0) {
    sourceSections.push(`## ${headings.entities}`)
    sourceSections.push(
      ...entityNodes
        .map((node) => {
          const pathKey = nodePathByKey.get(node.key)
          return pathKey ? `- ${linkLine(pathKey, node.name)}` : ""
        })
        .filter(Boolean),
    )
    sourceSections.push("")
  }

  if (conceptNodes.length > 0) {
    sourceSections.push(`## ${headings.concepts}`)
    sourceSections.push(
      ...conceptNodes
        .map((node) => {
          const pathKey = nodePathByKey.get(node.key)
          return pathKey ? `- ${linkLine(pathKey, node.name)}` : ""
        })
        .filter(Boolean),
    )
    sourceSections.push("")
  }

  if (sourceRelations.length > 0) {
    sourceSections.push(`## ${headings.relations}`)
    sourceSections.push(...sourceRelations)
    sourceSections.push("")
  }

  if (extraction.openQuestions.length > 0) {
    sourceSections.push(`## ${headings.questions}`)
    sourceSections.push(...extraction.openQuestions.slice(0, 8).map((q) => `- ${q}`))
    sourceSections.push("")
  }

  const sourceFrontmatter = buildFrontmatter({
    type: "source",
    title: extraction.sourceTitle,
    date: dateIso,
    tags: extraction.sourceTags,
    related: Array.from(relatedMap.get(sourceKey) ?? []).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    sources: [sourceFileName],
  })
  files.push({
    path: sourcePath,
    content: `${sourceFrontmatter}${sourceSections.join("\n").trim()}\n`,
  })

  for (const node of extraction.nodes) {
    const pathKey = nodePathByKey.get(node.key)
    if (!pathKey) continue
    const pagePath = `wiki/${pathKey}.md`
    const related = Array.from(relatedMap.get(pathKey) ?? []).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    const evidenceLines = node.evidence.slice(0, 10).map((item) => `- ${item}`)
    const relationLines = uniq(relationLinesByNode.get(node.key) ?? []).slice(0, 16)
    const summaryFallback = cjkMode ? "该条目由结构化抽取生成，后续可继续补充。"
      : "This entry was generated from structured extraction and can be expanded."
    const body = [
      `# ${node.name}`,
      "",
      `## ${headings.summary}`,
      node.summary || summaryFallback,
      "",
      evidenceLines.length > 0 ? `## ${headings.evidence}` : "",
      evidenceLines.length > 0 ? evidenceLines.join("\n") : "",
      evidenceLines.length > 0 ? "" : "",
      relationLines.length > 0 ? `## ${headings.relations}` : "",
      relationLines.length > 0 ? relationLines.join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n")

    const frontmatter = buildFrontmatter({
      type: node.kind,
      title: node.name,
      date: dateIso,
      tags: [node.kind],
      related,
      sources: [sourceFileName],
      aliases: uniq(node.aliases.filter((alias) => alias !== node.name)).slice(0, 12),
    })

    files.push({
      path: pagePath,
      content: `${frontmatter}${body.trim()}\n`,
    })
  }

  return {
    files,
    sourcePath,
    unresolved: extraction.unresolved,
    openQuestions: extraction.openQuestions,
    stats: {
      nodeCount: extraction.nodes.length,
      edgeCount: extraction.edges.length,
      entityCount: entityNodes.length,
      conceptCount: conceptNodes.length,
    },
  }
}
