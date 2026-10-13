#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
export * from "../__app_modules/wellness/fitness/cli/rings-migration.mjs";
import { runCliEntry } from "../__app_modules/wellness/fitness/cli/rings-migration.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { runCliEntry(); }
