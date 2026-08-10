import { defineConfig, type PluginOption } from "vite";
import { copyFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, join as joinPath } from "node:path";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { createRequire } from "node:module";

// The ffmpeg binary is a runtime asset, not an import, so Nitro's tracer only
// picks up ffmpeg-static's little JS shim and leaves the executable behind —
// which fails at runtime with a path that doesn't exist. Resolve the real binary
// for whatever platform is building (Linux on Vercel) and force it into the
// trace. It's what cuts a photo's still frame out of the generated clip; see
// extractLastFrame in src/lib/media-finalize.server.ts.
const ffmpegBinary = createRequire(import.meta.url)("ffmpeg-static") as string;

// Nitro 3 has no traceInclude, so copy the binary into the serverless function
// ourselves. It lands at bin/ffmpeg next to the function entry, which is what
// FFMPEG_BIN in media-finalize.server.ts looks for. Marked executable because a
// copied file loses the +x bit and would fail with EACCES on Vercel.
function bundleFfmpeg(): PluginOption {
  return {
    name: "bundle-ffmpeg",
    apply: "build",
    async closeBundle() {
      const fnDir = resolvePath(".vercel/output/functions/__server.func");
      if (!existsSync(fnDir) || !existsSync(ffmpegBinary)) return;
      const destDir = joinPath(fnDir, "bin");
      mkdirSync(destDir, { recursive: true });
      const dest = joinPath(destDir, "ffmpeg");
      copyFileSync(ffmpegBinary, dest);
      chmodSync(dest, 0o755);
    },
  };
}

// Standalone TanStack Start config (previously wrapped by
// @lovable.dev/vite-tanstack-config). Builds a Nitro server targeting Vercel
// (outputs .vercel/output via Vercel Build Output API v3).
export default defineConfig({
  server: { host: "::", port: 8080 },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // Redirect the bundled server entry to src/server.ts (SSR error wrapper).
      server: { entry: "server" },
    }),
    // maxDuration: image selfies chain slow Replicate models (SDXL + face-swap)
    // in one request; the default serverless timeout kills them. 300s is the
    // Vercel Pro/Fluid max (capped down automatically on smaller plans).
    nitro({ preset: "vercel", vercel: { functions: { maxDuration: 300 } } }),
    bundleFfmpeg(),
    viteReact(),
  ],
});
