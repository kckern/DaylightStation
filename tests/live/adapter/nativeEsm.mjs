/**
 * Run an ES-module snippet in a real Node process and return its stdout.
 *
 * The live tier runs under Jest + babel (tests/_infrastructure/config/babel.config.cjs),
 * which rewrites `import.meta.url` to a `require(...)` that does not exist in native ESM and
 * loads `.js` files as CommonJS. Some modules under test (vendorFonts.mjs, presetManifest.js)
 * need genuine ESM semantics, so the checks that touch them run in a child process. The
 * child throws on failure; the message surfaces in the Jest assertion. Paths are resolved
 * from the cwd (the repo root), since `import.meta` is unavailable to this file too.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repoUrl = (rel) => pathToFileURL(resolve(process.cwd(), rel)).href;

export function runEsm(code, env = {}) {
  try {
    return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(String(err.stderr || err.message).split('\n').filter(Boolean).slice(0, 6).join('\n'));
  }
}
