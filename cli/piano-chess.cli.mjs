#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
import { pathToFileURL } from 'node:url';
export * from "../__app_modules/learning/piano/cli/piano-chess.cli.mjs";
import { runCliEntry } from "../__app_modules/learning/piano/cli/piano-chess.cli.mjs";

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCliEntry();
}
