import { Suspense, lazy } from "react"
import { useWikiStore } from "@/stores/wiki-store"

const ChatPanel = lazy(async () => {
  const mod = await import("@/components/chat/chat-panel")
  return { default: mod.ChatPanel }
})
const SettingsView = lazy(async () => {
  const mod = await import("@/components/settings/settings-view")
  return { default: mod.SettingsView }
})
const SourcesView = lazy(async () => {
  const mod = await import("@/components/sources/sources-view")
  return { default: mod.SourcesView }
})
const ReviewView = lazy(async () => {
  const mod = await import("@/components/review/review-view")
  return { default: mod.ReviewView }
})
const LintView = lazy(async () => {
  const mod = await import("@/components/lint/lint-view")
  return { default: mod.LintView }
})
const SearchView = lazy(async () => {
  const mod = await import("@/components/search/search-view")
  return { default: mod.SearchView }
})
const GraphView = lazy(async () => {
  const mod = await import("@/components/graph/graph-view")
  return { default: mod.GraphView }
})

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  let view = <ChatPanel />
  switch (activeView) {
    case "settings":
      view = <SettingsView />
      break
    case "sources":
      view = <SourcesView />
      break
    case "review":
      view = <ReviewView />
      break
    case "lint":
      view = <LintView />
      break
    case "search":
      view = <SearchView />
      break
    case "graph":
      view = <GraphView />
      break
    default:
      view = <ChatPanel />
      break
  }

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading view...</div>}>
      {view}
    </Suspense>
  )
}
