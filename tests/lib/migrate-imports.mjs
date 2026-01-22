#!/usr/bin/env node
/**
 * Migrate test imports from relative paths to @backend/ aliases
 *
 * Usage: node tests/lib/migrate-imports.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

// Patterns to convert
const patterns = [
  // Static imports: from '@backend/...' -> from '@backend/...'
  {
    regex: /from\s+['"](\.\.\/)+(backend\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `from '@backend/${path.replace(/^backend\//, '')}'`
  },
  // Dynamic imports: import('@backend/...') -> import('@backend/...')
  {
    regex: /import\s*\(\s*['"](\.\.\/)+(backend\/[^'"]+)['"]\s*\)/g,
    replace: (match, dots, path) => `import('@backend/${path.replace(/^backend\//, '')}')`
  },
  // Jest mockModule: mockModule('@backend/...') -> mockModule('@backend/...')
  {
    regex: /mockModule\s*\(\s*['"](\.\.\/)+(backend\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `mockModule('@backend/${path.replace(/^backend\//, '')}'`
  },
  // Static imports for frontend: from '../frontend/...' -> from '@frontend/...'
  {
    regex: /from\s+['"](\.\.\/)+(frontend\/src\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `from '@frontend/${path.replace(/^frontend\/src\//, '')}'`
  },
  // Dynamic imports for frontend: import('../frontend/...') -> import('@frontend/...')
  {
    regex: /import\s*\(\s*['"](\.\.\/)+(frontend\/src\/[^'"]+)['"]\s*\)/g,
    replace: (match, dots, path) => `import('@frontend/${path.replace(/^frontend\/src\//, '')}')`
  },
  // Jest mockModule for frontend: mockModule('../frontend/...') -> mockModule('@frontend/...')
  {
    regex: /mockModule\s*\(\s*['"](\.\.\/)+(frontend\/src\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `mockModule('@frontend/${path.replace(/^frontend\/src\//, '')}'`
  },
  // Static imports for _extensions: from '@extensions/...' -> from '@extensions/...'
  {
    regex: /from\s+['"](\.\.\/)+(\_extensions\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `from '@extensions/${path.replace(/^_extensions\//, '')}'`
  },
  // Dynamic imports for _extensions: import('@extensions/...') -> import('@extensions/...')
  {
    regex: /import\s*\(\s*['"](\.\.\/)+(\_extensions\/[^'"]+)['"]\s*\)/g,
    replace: (match, dots, path) => `import('@extensions/${path.replace(/^_extensions\//, '')}')`
  },
  // Static imports for _fixtures: from '@fixtures/...' -> from '@fixtures/...'
  {
    regex: /from\s+['"](\.\.\/)+(tests\/_fixtures\/[^'"]+|_fixtures\/[^'"]+)['"]/g,
    replace: (match, dots, path) => {
      const fixturePath = path.replace(/^(tests\/)?_fixtures\//, '');
      return `from '@fixtures/${fixturePath}'`;
    }
  },
  // Note: path.resolve with _fixtures should NOT be converted - those need real paths, not aliases
  // Static imports for tests/lib: from '@testlib/...' or '../../lib/...' -> from '@testlib/...'
  {
    regex: /from\s+['"](\.\.\/)+(tests\/lib\/[^'"]+|lib\/[^'"]+)['"]/g,
    replace: (match, dots, path) => {
      // Only convert if it's the tests/lib, not backend/lib
      if (path.includes('tests/lib/') || (path.startsWith('lib/') && !path.includes('backend'))) {
        const libPath = path.replace(/^(tests\/)?lib\//, '');
        return `from '@testlib/${libPath}'`;
      }
      return match; // Don't convert backend/lib references
    }
  }
];

function processFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  let newContent = content;
  let changed = false;

  for (const { regex, replace } of patterns) {
    const matches = content.match(regex);
    if (matches) {
      newContent = newContent.replace(regex, replace);
      changed = true;
    }
  }

  if (changed) {
    if (dryRun) {
      console.log(`[DRY-RUN] Would update: ${filePath}`);
      // Show diff
      const oldLines = content.split('\n');
      const newLines = newContent.split('\n');
      for (let i = 0; i < oldLines.length; i++) {
        if (oldLines[i] !== newLines[i]) {
          console.log(`  - ${oldLines[i]}`);
          console.log(`  + ${newLines[i]}`);
        }
      }
    } else {
      writeFileSync(filePath, newContent);
      console.log(`Updated: ${filePath}`);
    }
    return true;
  }
  return false;
}

function walkDir(dir) {
  let count = 0;
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!entry.startsWith('.') && entry !== 'node_modules' && entry !== '_archive') {
        count += walkDir(fullPath);
      }
    } else if (entry.endsWith('.test.mjs') || entry.endsWith('.mjs')) {
      if (processFile(fullPath)) {
        count++;
      }
    }
  }

  return count;
}

console.log(`Migrating imports in ${testsDir}${dryRun ? ' (dry run)' : ''}...`);
const count = walkDir(testsDir);
console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${count} files`);
