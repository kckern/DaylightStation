#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
export * from "../__app_modules/media/media/cli/libretto.cli.mjs";
import { runCliEntry } from "../__app_modules/media/media/cli/libretto.cli.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { await runCliEntry(); }
