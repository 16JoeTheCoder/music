import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = (await readdir("dist/assets"))
  .filter((n) => /\.(js|css|woff2?)$/.test(n))
  .map((n) => "/assets/" + n);
const shell = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  ...assets,
];
const hash = createHash("sha256");
for (const path of shell)
  hash.update(await readFile(path === "/" ? "dist/index.html" : "dist" + path));
const version = hash.digest("hex").slice(0, 16);
let sw = await readFile("public/sw.js", "utf8");
sw = sw
  .replace("__BUILD_CACHE__", `still-shell-${version}`)
  .replace(/\/\*__SHELL__\*\/\s*\[\]/, JSON.stringify(shell));
if (sw.includes("__SHELL__") || sw.includes("__BUILD_CACHE__"))
  throw Error("Offline shell injection failed");
await writeFile("dist/sw.js", sw);
console.log(`Offline shell: ${shell.length} assets, version ${version}`);
