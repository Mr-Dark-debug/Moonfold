import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
await cp(path.join(root, "public"), output, { recursive: true });
for (const file of [
  "index.html",
  "styles.css",
  "main.js",
  "folders.js",
  "season.js",
  "seasonal.js",
  "content.css",
  "content.js",
]) {
  await cp(path.join(root, "src", file), path.join(output, file));
}
async function size(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await size(file) : (await stat(file)).size;
  }
  return total;
}
console.log(
  `Built standalone site → dist (${((await size(output)) / 1024 / 1024).toFixed(2)} MB). No runtime dependencies.`,
);
