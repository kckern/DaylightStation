#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
export * from "../__app_modules/party-games/cli/charades-history.cli.mjs";
import { runCliEntry } from "../__app_modules/party-games/cli/charades-history.cli.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { runCliEntry(); }
