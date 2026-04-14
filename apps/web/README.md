# LLM Wiki Frontend (Upstream Sync)

This folder contains a full frontend sync from:

- Upstream: `https://github.com/nashsu/llm_wiki`
- Synced tree SHA: `21a9e7d195c705ca182f6f449dbc5f0125f544ad`
- Synced date: `2026-04-14`

## Run

```bash
cd apps/web
npm install
npm run dev
```

## Notes

- This is the upstream frontend architecture (`src/components`, `src/lib`, `src/stores`, i18n, graph/chat/research views).
- It is Tauri-oriented by default and expects matching desktop/native commands.
- Backend adaptation to this repository's Python APIs will be done incrementally on top of this synced baseline.

