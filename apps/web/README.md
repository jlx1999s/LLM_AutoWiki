# LLM Wiki Frontend (Upstream Sync)

This folder contains a full frontend sync from:

- Upstream: `https://github.com/nashsu/llm_wiki`
- Synced tree SHA: `21a9e7d195c705ca182f6f449dbc5f0125f544ad`
- Synced date: `2026-04-14`

## Run

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload

cd apps/web
npm install
npm run dev
```

Optional backend URL override:

```bash
VITE_BACKEND_URL=http://127.0.0.1:8000 npm run dev
```

## Notes

- This is the upstream frontend architecture (`src/components`, `src/lib`, `src/stores`, i18n, graph/chat/research views).
- Tauri calls are redirected to web shims via Vite aliases:
  - `@tauri-apps/api/core` -> `src/shims/tauri-core.ts`
  - `@tauri-apps/plugin-dialog` -> `src/shims/tauri-dialog.ts`
  - `@tauri-apps/plugin-store` -> `src/shims/tauri-store.ts`
- Shim `invoke` calls backend bridge endpoint: `/api/bridge/invoke`.
