// Stable command entry; implementation belongs to its declared owner.
import { fileURLToPath, pathToFileURL } from 'node:url';
export * from "../modules/chess/cli/chess-calibrate.cli.mjs";
import { runCliEntry } from "../modules/chess/cli/chess-calibrate.cli.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { await runCliEntry(); }
