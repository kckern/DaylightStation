#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
export * from "../modules/school/cli/bible-lesson-pages.mjs";
import { runCliEntry } from "../modules/school/cli/bible-lesson-pages.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { runCliEntry(); }
