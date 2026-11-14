import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "path";

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { outDir: mode === "single" ? "dist-single" : "dist" },
  // The single-file build is the shareable offline demo: never point it at a backend, even if .env.local exists.
  define: mode === "single"
    ? { "import.meta.env.VITE_SUPABASE_URL": "undefined", "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": "undefined", "import.meta.env.VITE_SUPABASE_ANON_KEY": "undefined" }
    : {},
  test: { environment: "node" },
}));
