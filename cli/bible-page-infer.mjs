#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
export * from "../__app_modules/learning/school/cli/bible-page-infer.mjs";
import { runCliEntry } from "../__app_modules/learning/school/cli/bible-page-infer.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { runCliEntry(); }
