import { beforeAll, describe, expect, it } from "vitest"

interface LinkRegistryEntry {
  path: string
  slug: string
  title: string
  aliases: string[]
}

let normalizeLinkKey: (value: string) => string
let baseNameFromSlug: (slug: string) => string
let buildLinkLookup: (entries: LinkRegistryEntry[]) => Map<string, LinkRegistryEntry>

beforeAll(async () => {
  ;(globalThis as { window?: { location: { protocol: string; host: string; hostname: string } } }).window = {
    location: { protocol: "http:", host: "localhost:5173", hostname: "localhost" },
  }

  const mod = await import("@/lib/link-registry")
  normalizeLinkKey = mod.normalizeLinkKey
  baseNameFromSlug = mod.baseNameFromSlug
  buildLinkLookup = mod.buildLinkLookup as (entries: LinkRegistryEntry[]) => Map<string, LinkRegistryEntry>
})

describe("link-registry", () => {
  it("normalizes link keys consistently", () => {
    expect(normalizeLinkKey(" Concepts/Foo.md ")).toBe("concepts/foo")
    expect(normalizeLinkKey("foo\\\\bar")).toBe("foo/bar")
  })

  it("returns basename from slug", () => {
    expect(baseNameFromSlug("concepts/llm-wiki")).toBe("llm-wiki")
    expect(baseNameFromSlug("小儿肥胖症")).toBe("小儿肥胖症")
  })

  it("removes ambiguous lookup keys", () => {
    const entries: LinkRegistryEntry[] = [
      {
        path: "concepts/alpha.md",
        slug: "concepts/alpha",
        title: "Alpha",
        aliases: ["A"],
      },
      {
        path: "entities/alpha.md",
        slug: "entities/alpha",
        title: "Alpha Entity",
        aliases: ["A"],
      },
    ]

    const lookup = buildLinkLookup(entries)
    expect(lookup.has("a")).toBe(false)
    expect(lookup.has("alpha")).toBe(false)
    expect(lookup.get("concepts/alpha")?.slug).toBe("concepts/alpha")
    expect(lookup.get("entities/alpha")?.slug).toBe("entities/alpha")
  })
})
