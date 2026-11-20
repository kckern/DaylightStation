#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
import { pathToFileURL } from 'node:url';
export * from "../__app_modules/learning/piano/cli/piano-segment-calibrate.cli.mjs";
import { runCliEntry } from "../__app_modules/learning/piano/cli/piano-segment-calibrate.cli.mjs";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { runCliEntry(); }
