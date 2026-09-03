#!/usr/bin/env node
/**
 * SCSS build gate — every stylesheet Vite actually ships must compile.
 *
 * WHY THIS EXISTS. `frontend/src/modules/Health/health.scss` shipped a line
 * (`&--group&--thumb { ... }`) that Dart Sass rejects outright ("& may only
 * used at the beginning of a compound selector"). It reached `main` because
 * none of the existing gates compile SCSS: jsdom-based tests never touch the
 * stylesheet, `audit:ui` (audit-ui-tokens.mjs) is a text scanner, and
 * `check:parse` only parses JS/TS/JSX via esbuild. A real `vite build` would
 * have caught it immediately, but nobody had run one on that branch.
 *
 * SCOPE. Only the files Vite treats as entrypoints — those imported directly
 * by a `.jsx`/`.js`/`.mjs` file (`import './Foo.scss'`) — are compiled.
 * Partials (`_foo.scss`, token/mixin files consumed only via `@use`/`@import`)
 * are pulled in as part of compiling their entrypoint, exactly as Vite does
 * it; compiling them a second time standalone would be pure overhead and can
 * produce false failures for partials that assume a consumer's context.
 *
 * ALIASES. Dart Sass's `@use`/`@import` resolution knows nothing of Vite's
 * `resolve.alias` (`@gaming-ui`, `@shared-contracts`, …), so a handful of
 * entrypoints that reference those aliases would otherwise fail here with a
 * false "Can't find stylesheet to import". A custom importer below mirrors
 * `frontend/vite.config.js`'s alias map — keep the two in sync if aliases
 * change there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as sass from 'sass';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'frontend/src');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '_deleteme',
  '.claude', '.claire', '.worktrees', '.superpowers', 'playwright-report',
  'test-results', '.vite', '.cache',
]);

// Mirrors frontend/vite.config.js `resolve.alias`. Keep in sync.
const ALIASES = {
  '@gaming-ui': path.join(ROOT, 'frontend/src/modules/Gaming/platform/ui'),
  '@gaming': path.join(ROOT, 'frontend/src/modules/Gaming'),
  '@shared-contracts': path.join(ROOT, 'frontend/shared/contracts'),
  '@shared-music': path.join(ROOT, 'frontend/shared/music'),
  '@shared-gaming': path.join(ROOT, 'frontend/shared/gaming'),
  '@shared-interaction': path.join(ROOT, 'frontend/shared/interaction'),
  '@shared-presentation': path.join(ROOT, 'frontend/shared/presentation/scenes'),
  '@': path.join(ROOT, 'frontend/src'),
};

function resolveAliasTarget(base) {
  const candidates = [
    base,
    `${base}.scss`,
    path.join(path.dirname(base), `_${path.basename(base)}.scss`),
    path.join(base, 'index.scss'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const aliasImporter = {
  canonicalize(url) {
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (url === alias || url.startsWith(`${alias}/`)) {
        const rest = url.slice(alias.length);
        const resolved = resolveAliasTarget(path.join(target, rest));
        if (resolved) return pathToFileURL(resolved);
      }
    }
    return null;
  },
  load(canonicalUrl) {
    return { contents: fs.readFileSync(canonicalUrl, 'utf8'), syntax: 'scss' };
  },
};

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(jsx|js|mjs)$/.test(entry.name)) {
      yield full;
    }
  }
}

// Entrypoints = .scss files directly `import`ed by app source, deduped —
// exactly the set Vite hands to its CSS pipeline as a build unit.
const IMPORT_RE = /import\s+['"](\.[^'"]+\.scss)['"]/g;
function findEntrypoints() {
  const entries = new Set();
  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      entries.add(path.normalize(path.join(path.dirname(file), match[1])));
    }
  }
  return [...entries].sort();
}

function main() {
  const entrypoints = findEntrypoints();
  const failures = [];

  for (const file of entrypoints) {
    try {
      sass.compile(file, {
        importers: [aliasImporter],
        quietDeps: true,
        logger: sass.Logger.silent,
      });
    } catch (error) {
      const span = error?.span;
      const line = span?.start?.line != null ? span.start.line + 1 : 0; // 0-based -> 1-based
      failures.push({
        file: path.relative(ROOT, file),
        line,
        why: (error?.message ?? String(error)).split('\n')[0],
      });
    }
  }

  if (failures.length) {
    console.error(`\nSCSS build gate FAILED — ${failures.length} stylesheet(s) will not compile:\n`);
    for (const f of failures) console.error(`  ${f.file}:${f.line}\n    ${f.why}`);
    console.error('\nThis is what `vite build` (and therefore the Docker image build) would');
    console.error('hit too — fix the selector/syntax, then re-run `npm run check:scss`.\n');
    process.exit(1);
  }

  console.log(`SCSS build gate OK — ${entrypoints.length} entrypoint stylesheet(s) compiled.`);
}

main();
