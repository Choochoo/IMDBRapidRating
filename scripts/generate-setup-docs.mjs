import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SetupGuideFlows } from "../src/app/setup-guide-definitions.js";
import { BuildScreenshotChecklist, RenderSetupGuide, RenderSetupGuideIndex, SetupGuideDocumentName } from "./setup-guide-docs.mjs";

const TextEncoding = "utf8";
const RootPath = process.cwd();
const OutputDirectory = path.join(RootPath, "docs", "setup");
const Checklist = await BuildScreenshotChecklist(SetupGuideFlows, RootPath);

await mkdir(OutputDirectory, { recursive: true });
const Writes = SetupGuideFlows.map((flow) => writeFile(path.join(OutputDirectory, SetupGuideDocumentName(flow)), RenderSetupGuide(flow, Checklist), TextEncoding));
Writes.push(writeFile(path.join(OutputDirectory, "README.md"), RenderSetupGuideIndex(SetupGuideFlows, Checklist), TextEncoding));
Writes.push(writeFile(path.join(OutputDirectory, "screenshots.json"), `${JSON.stringify(Checklist, null, 2)}\n`, TextEncoding));
await Promise.all(Writes);

console.log(`Generated ${SetupGuideFlows.length} setup guides. ${Checklist.summary.needed} screenshots still need capture.`);
