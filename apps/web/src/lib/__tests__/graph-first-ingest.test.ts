import { describe, expect, it } from "vitest"

import {
  compileStructuredGraphToWiki,
  parseStructuredExtractionCandidate,
  parseStructuredExtractionResponse,
  runStructuredGraphQualityGate,
} from "@/lib/graph-first-ingest"

describe("graph-first-ingest", () => {
  it("parses structured extraction JSON with aliases and relations", () => {
    const raw = [
      "```json",
      JSON.stringify({
        source: {
          title: "儿童肺炎支原体肺炎诊疗指南（2025年版）",
          summary: "本指南明确了MPP诊断和治疗的关键路径。",
          tags: ["儿科", "指南"],
          highlights: ["强调病原学检测"],
        },
        entities: [
          {
            name: "肺炎支原体（MP）",
            aliases: ["MP"],
            summary: "常见病原体。",
            evidence: ["病原学检测显示MP阳性"],
          },
        ],
        concepts: [
          {
            name: "儿童肺炎支原体肺炎（MPP）",
            aliases: ["MPP"],
            summary: "儿童常见呼吸系统疾病。",
          },
        ],
        edges: [
          {
            source: "肺炎支原体（MP）",
            target: "儿童肺炎支原体肺炎（MPP）",
            relation: "causes",
            confidence: 0.82,
            evidence: "MP是MPP相关病原体",
          },
        ],
      }),
      "```",
    ].join("\n")

    const extracted = parseStructuredExtractionResponse(raw, "儿童肺炎支原体肺炎诊疗指南（2025年版）_processed.md")
    expect(extracted.nodes.length).toBe(2)
    expect(extracted.edges.length).toBeGreaterThanOrEqual(1)
    expect(extracted.nodes.some((n) => n.name.includes("MP"))).toBe(true)
    expect(extracted.nodes.some((n) => n.name.includes("MPP"))).toBe(true)
  })

  it("compiles deterministic source/entity/concept pages", () => {
    const extracted = parseStructuredExtractionResponse(
      JSON.stringify({
        source: {
          title: "Test Source",
          summary: "A source summary.",
          tags: ["tag-a"],
        },
        nodes: [
          {
            name: "阿奇霉素",
            kind: "concept",
            aliases: ["azithromycin"],
            summary: "大环内酯类抗菌药物。",
          },
          {
            name: "肺炎支原体肺炎",
            kind: "concept",
            summary: "儿童常见呼吸道感染疾病。",
          },
        ],
        edges: [
          {
            source: "阿奇霉素",
            target: "肺炎支原体肺炎",
            relation: "treats",
            confidence: 0.9,
          },
          {
            source: "肺炎支原体肺炎",
            target: "阿奇霉素",
            relation: "associated_with",
            confidence: 0.4,
          },
        ],
      }),
      "test-source.md",
    )

    const compiled = compileStructuredGraphToWiki(extracted, "test-source.md", "2026-04-17")
    expect(compiled.files.length).toBe(3)
    expect(compiled.sourcePath).toBe("wiki/sources/test-source.md")

    const source = compiled.files.find((f) => f.path === "wiki/sources/test-source.md")
    const concept = compiled.files.find((f) => f.path.startsWith("wiki/concepts/"))

    expect(source?.content).toContain('type: source')
    expect(concept?.content).toContain('type: concept')
    expect(source?.content).toContain("[[concepts/阿奇霉素|阿奇霉素]]")
    expect(source?.content).toContain("treats")
    expect(source?.content).not.toContain("associated_with")
    expect(concept?.content).toContain("related:")
  })

  it("corrects direction for may_progress_to", () => {
    const extracted = parseStructuredExtractionResponse(
      JSON.stringify({
        source: {
          title: "Progression Test",
          summary: "Disease severity progression.",
        },
        concepts: [
          { name: "重症肺炎支原体肺炎", summary: "重症阶段" },
          { name: "危重肺炎支原体肺炎", summary: "危重阶段" },
        ],
        edges: [
          {
            source: "危重肺炎支原体肺炎",
            target: "重症肺炎支原体肺炎",
            relation: "may_progress_to",
            confidence: 0.8,
          },
        ],
      }),
      "progress.md",
    )
    expect(extracted.edges.length).toBe(1)
    expect(extracted.edges[0].sourceName).toBe("重症肺炎支原体肺炎")
    expect(extracted.edges[0].targetName).toBe("危重肺炎支原体肺炎")
  })

  it("forces disease-like nodes to concept even when model marks entity", () => {
    const extracted = parseStructuredExtractionResponse(
      JSON.stringify({
        source: { title: "Kind Test", summary: "kind inference" },
        nodes: [
          { name: "重症肺炎支原体肺炎（SMPP）", kind: "entity", summary: "严重感染性肺炎分型" },
          { name: "肺炎支原体（MP）", kind: "entity", summary: "主要病原体" },
        ],
        edges: [
          { source: "肺炎支原体（MP）", target: "重症肺炎支原体肺炎（SMPP）", relation: "causes", confidence: 0.9 },
        ],
      }),
      "kind-test.md",
    )

    const smpp = extracted.nodes.find((n) => n.name.includes("SMPP"))
    const mp = extracted.nodes.find((n) => n.name.includes("MP）"))
    expect(smpp?.kind).toBe("concept")
    expect(mp?.kind).toBe("entity")
    expect(extracted.edges.length).toBeGreaterThanOrEqual(1)
  })

  it("parses candidate graph before semantic normalization", () => {
    const candidate = parseStructuredExtractionCandidate(
      JSON.stringify({
        source: { title: "Candidate Test", summary: "A short summary." },
        nodes: [{ name: "肺炎支原体", kind: "entity", aliases: ["MP"] }],
        edges: [{ source: "肺炎支原体", target: "肺炎支原体", relation: "associated_with", confidence: 0.5 }],
      }),
      "candidate.md",
    )

    expect(candidate.sourceTitle).toBe("Candidate Test")
    expect(candidate.nodes.length).toBe(1)
    expect(candidate.edges.length).toBe(1)
    expect(candidate.edges[0].source).toBe("肺炎支原体")
  })

  it("fails quality gate when semantic specificity collapses", () => {
    const extracted = parseStructuredExtractionResponse(
      JSON.stringify({
        source: { title: "Quality Test", summary: "quality gate sample" },
        nodes: [
          { name: "节点1", kind: "concept" },
          { name: "节点2", kind: "concept" },
          { name: "节点3", kind: "concept" },
          { name: "节点4", kind: "concept" },
          { name: "节点5", kind: "concept" },
          { name: "节点6", kind: "concept" },
          { name: "节点7", kind: "concept" },
        ],
        edges: [
          { source: "节点1", target: "节点2", relation: "associated_with", confidence: 0.9 },
          { source: "节点1", target: "节点3", relation: "associated_with", confidence: 0.9 },
          { source: "节点2", target: "节点3", relation: "associated_with", confidence: 0.9 },
          { source: "节点2", target: "节点4", relation: "associated_with", confidence: 0.9 },
          { source: "节点3", target: "节点4", relation: "associated_with", confidence: 0.9 },
          { source: "节点4", target: "节点5", relation: "associated_with", confidence: 0.9 },
          { source: "节点5", target: "节点6", relation: "associated_with", confidence: 0.9 },
        ],
      }),
      "quality.md",
    )

    const report = runStructuredGraphQualityGate(extracted)
    expect(
      report.issues.some((issue) =>
        issue.severity === "error" &&
        (issue.code === "too_many_associated_edges" || issue.code === "no_edges"),
      ),
    ).toBe(true)
  })
})
