import {
  compileStructuredGraphToWiki,
  normalizeStructuredExtraction,
  parseStructuredExtractionCandidate,
  runStructuredGraphQualityGate,
  type CompiledWikiResult,
  type StructuredExtraction,
  type StructuredExtractionCandidate,
  type StructuredGraphQualityReport,
} from "@/lib/graph-first-ingest"

export interface StructuredIngestPipelineResult {
  candidate: StructuredExtractionCandidate
  extraction: StructuredExtraction
  quality: StructuredGraphQualityReport
  compiled: CompiledWikiResult
}

export interface StructuredIngestPipelineInput {
  raw: string
  sourceFileName: string
  dateIso?: string
}

export function runStructuredIngestPipeline(
  input: StructuredIngestPipelineInput,
): StructuredIngestPipelineResult {
  const candidate = parseStructuredExtractionCandidate(input.raw, input.sourceFileName)
  const extraction = normalizeStructuredExtraction(candidate)
  const quality = runStructuredGraphQualityGate(extraction)
  const compiled = compileStructuredGraphToWiki(
    extraction,
    input.sourceFileName,
    input.dateIso,
  )
  return { candidate, extraction, quality, compiled }
}

export function summarizeStructuredQualityErrors(report: StructuredGraphQualityReport): string[] {
  return report.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.code}: ${issue.message}`)
}

