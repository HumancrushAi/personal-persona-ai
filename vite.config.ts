import { defineConfig, type PluginOption } from "vite";
import { copyFileSync, chmodSync, mkdirSync, existsSync, readdirSync } from "node:fs";
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

// The banner compositor draws its type as glyph outlines read straight from
// these .ttf files (see src/lib/banner-compositor.server.ts). Like the ffmpeg
// binary they are runtime assets rather than imports, so Nitro's tracer never
// sees them and they have to be copied in by hand. Without them the compositor
// throws on the first banner instead of silently rendering a blank one.
function bundleFonts(): PluginOption {
  return {
    name: "bundle-fonts",
    apply: "build",
    async closeBundle() {
      const fnDir = resolvePath(".vercel/output/functions/__server.func");
      const srcDir = resolvePath("fonts");
      if (!existsSync(fnDir) || !existsSync(srcDir)) return;
      const destDir = joinPath(fnDir, "fonts");
      mkdirSync(destDir, { recursive: true });
      for (const file of readdirSync(srcDir)) {
        copyFileSync(joinPath(srcDir, file), joinPath(destDir, file));
      }
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
    bundleFonts(),
    viteReact(),
  ],
});
