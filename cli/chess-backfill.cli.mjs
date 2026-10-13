// Stable command entry; implementation belongs to its declared owner.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export * from "../__app_modules/learning/piano/cli/chess-backfill.cli.mjs";
import { runCliEntry } from "../__app_modules/learning/piano/cli/chess-backfill.cli.mjs";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { runCliEntry(); }
