#!/usr/bin/env node
import { runCliEntry } from "../modules/health/cli/health-scan-repair.cli.mjs";
import path from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCliEntry();
