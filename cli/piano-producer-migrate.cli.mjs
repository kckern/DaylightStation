#!/usr/bin/env node
// Stable command entry; implementation belongs to Piano.
import { pathToFileURL } from 'node:url';
export * from '../modules/piano/cli/piano-producer-migrate.cli.mjs';
import { runCliEntry } from '../modules/piano/cli/piano-producer-migrate.cli.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCliEntry();
}
