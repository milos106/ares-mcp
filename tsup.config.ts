import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/http.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: false,
  minify: false,
  splitting: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
});
