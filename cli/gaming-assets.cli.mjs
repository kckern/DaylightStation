#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from '../__capabilities/gaming/cli/gaming-assets.cli.mjs';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
