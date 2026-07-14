import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["scripts", "server", "shared", "src"];
const files = [];
for (const root of roots)
  await Collect(root, files);
for (const file of files.filter((item) => /\.(?:m?js)$/.test(item))) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status)
    process.exit(result.status);
}

async function Collect(folder, output) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory())
      await Collect(fullPath, output);
    else
      output.push(fullPath);
  }
}
