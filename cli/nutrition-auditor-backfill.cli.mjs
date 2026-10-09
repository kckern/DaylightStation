#!/usr/bin/env node
import { runCliEntry } from "../modules/health/cli/nutrition-auditor-backfill.cli.mjs";
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) runCliEntry();
