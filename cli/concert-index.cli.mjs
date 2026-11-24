#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
import { pathToFileURL } from "node:url";
export * from "../__app_modules/media/media/cli/concert-index.cli.mjs";
import { runCliEntry } from "../__app_modules/media/media/cli/concert-index.cli.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { await runCliEntry(); }
