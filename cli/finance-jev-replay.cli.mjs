// Stable command entry; implementation belongs to its declared owner.
import { fileURLToPath, pathToFileURL } from 'node:url';
export * from "../__app_modules/money/finance/cli/finance-jev-replay.cli.mjs";
import { runCliEntry } from "../__app_modules/money/finance/cli/finance-jev-replay.cli.mjs";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { runCliEntry(); }
