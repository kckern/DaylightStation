// Stable command entry; implementation belongs to its declared owner.
import { fileURLToPath, pathToFileURL } from 'node:url';
export * from "../modules/finance/cli/finance-jev-replay.cli.mjs";
import { runCliEntry } from "../modules/finance/cli/finance-jev-replay.cli.mjs";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { runCliEntry(); }
