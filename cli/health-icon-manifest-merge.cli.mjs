#!/usr/bin/env node
import { runCliEntry } from "../__app_modules/wellness/health/cli/health-icon-manifest-merge.cli.mjs";
import path from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCliEntry();
