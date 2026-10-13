// Stable command entry; implementation belongs to its declared owner.
import { pathToFileURL } from 'node:url';
export * from "../__app_modules/chess/cli/chess.cli.mjs";
import { runCliEntry } from "../__app_modules/chess/cli/chess.cli.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { runCliEntry(); }
