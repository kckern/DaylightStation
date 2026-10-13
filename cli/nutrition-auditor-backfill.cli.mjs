#!/usr/bin/env node
import { runCliEntry } from "../__app_modules/wellness/health/cli/nutrition-auditor-backfill.cli.mjs";
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) runCliEntry();
