import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
const assets = files(".next/static").filter((file) => /\.(js|css|woff2)$/.test(file)).map((file) => file.replace(".next/", "/_next/"));
const version = readFileSync(".next/BUILD_ID", "utf8").trim();
const source = readFileSync("scripts/service-worker.js", "utf8")
  .replace("__CACHE_VERSION__", JSON.stringify(`simply-track-${version}`))
  .replace("__PRECACHE_ASSETS__", JSON.stringify(["/", "/manifest.webmanifest", "/sqlite/sql-wasm.wasm", "/logo.svg", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png", ...assets]));
writeFileSync("public/sw.js", source);
console.log(`Generated offline worker for ${assets.length} app assets.`);
