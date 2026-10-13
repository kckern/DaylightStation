// Stable command entry; implementation belongs to its declared owner.
import { fileURLToPath, pathToFileURL } from 'node:url';
export * from "../__app_modules/chess/cli/chess-review.cli.mjs";
import { runCliEntry } from "../__app_modules/chess/cli/chess-review.cli.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { await runCliEntry(); }
