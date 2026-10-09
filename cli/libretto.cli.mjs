#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
export * from "../modules/media/cli/libretto.cli.mjs";
import { runCliEntry } from "../modules/media/cli/libretto.cli.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { await runCliEntry(); }
