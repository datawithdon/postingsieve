// Builds the extension into dist/. The content script is a single self-contained file:
// a loader that imports chunks would need web_accessible_resources, which lets any
// matched site detect the extension by requesting those files.
import { build } from "vite";

const shared = { configFile: false, logLevel: "warn" };

await build({
  ...shared,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false, // Vite's polyfill calls fetch(), which nothing here needs.
    rollupOptions: {
      input: { options: "src/options/index.html", panel: "src/panel/index.html", worker: "src/background/worker.ts" },
      output: { entryFileNames: "assets/[name].js", chunkFileNames: "assets/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
});

await build({
  ...shared,
  publicDir: false,
  build: {
    outDir: "dist/assets",
    emptyOutDir: false,
    sourcemap: false,
    lib: { entry: "src/content/main.ts", formats: ["iife"], name: "postingSieve", fileName: () => "content.js" },
  },
});
