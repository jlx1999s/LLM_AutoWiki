import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tauri-apps/api/core": path.resolve(__dirname, "./src/shims/tauri-core.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(
        __dirname,
        "./src/shims/tauri-dialog.ts",
      ),
      "@tauri-apps/plugin-store": path.resolve(
        __dirname,
        "./src/shims/tauri-store.ts",
      ),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "node",
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/@codemirror/")) {
            return "codemirror-vendor"
          }
          if (id.includes("/prosemirror-")) {
            return "prosemirror-vendor"
          }
          if (id.includes("@milkdown/")) {
            return "milkdown-vendor"
          }
          if (id.includes("katex") || id.includes("rehype-katex") || id.includes("remark-math")) {
            return "math-vendor"
          }
          if (
            id.includes("@react-sigma/") ||
            id.includes("graphology") ||
            id.includes("forceatlas2") ||
            id.includes("/sigma/")
          ) {
            return "graph-vendor"
          }
          if (id.includes("react-markdown") || id.includes("remark-gfm")) {
            return "markdown-vendor"
          }
          return undefined
        },
      },
    },
  },
}))
