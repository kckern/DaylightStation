#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runCliEntry } from '../modules/party-games/cli/gaming-artifacts.cli.mjs';
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCliEntry();
}
