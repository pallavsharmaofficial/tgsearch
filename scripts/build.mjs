import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["web/src/app.js"],
  bundle: true, minify: true, format: "iife", platform: "browser", target: "es2020",
  outfile: "dist/app.js",
  inject: ["web/src/shims.js"],
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  alias: {
    buffer: "buffer/", util: "util/", assert: "assert/", events: "events/",
    path: "path-browserify", os: "os-browserify/browser", stream: "stream-browserify",
    constants: "constants-browserify", crypto: "crypto-browserify", vm: "vm-browserify",
    "node-localstorage": "./web/src/empty.js", "graceful-fs": "./web/src/empty.js",
    fs: "./web/src/empty.js", net: "./web/src/empty.js", tls: "./web/src/empty.js", socks: "./web/src/empty.js",
  },
  logLevel: "warning",
});
// Content-hashed filename so a cached old script can never pair with a new page.
const hash = createHash("sha256").update(readFileSync("dist/app.js")).digest("hex").slice(0, 10);
renameSync("dist/app.js", `dist/app.${hash}.js`);
writeFileSync("dist/index.html", readFileSync("web/index.html", "utf8").replace('src="./app.js"', `src="./app.${hash}.js"`));
console.log("built dist/");
