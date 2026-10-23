import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
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
cpSync("web/index.html", "dist/index.html");
console.log("built dist/");
