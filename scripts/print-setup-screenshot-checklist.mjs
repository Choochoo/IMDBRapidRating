import { SetupGuideFlows } from "../src/app/setup-guide-definitions.js";
import { BuildScreenshotChecklist } from "./setup-guide-docs.mjs";

const Checklist = await BuildScreenshotChecklist(SetupGuideFlows, process.cwd());
process.stdout.write(`${JSON.stringify(Checklist, null, 2)}\n`);
