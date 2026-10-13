#!/usr/bin/env node
import { runCliEntry } from "../__app_modules/wellness/health/cli/curate-nutrition-icons.mjs";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCliEntry();
