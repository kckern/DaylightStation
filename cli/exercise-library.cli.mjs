#!/usr/bin/env node
// Stable command entry; implementation belongs to its application.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ENTRYPOINT = fileURLToPath(import.meta.url);
export * from "../__app_modules/fitness/cli/exercise-library.cli.mjs";
import { runCliEntry } from "../__app_modules/fitness/cli/exercise-library.cli.mjs";
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) { runCliEntry(); }
