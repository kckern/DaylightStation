#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCliEntry } from '../__app_modules/school/cli/school.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCliEntry();
