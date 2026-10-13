// Stable command entry; implementation belongs to its application.
export * from "../__app_modules/piano/cli/midi-to-musicxml.mjs";
import { runCliEntry } from "../__app_modules/piano/cli/midi-to-musicxml.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { runCliEntry(); }
