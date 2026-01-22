#!/usr/bin/env node
/**
 * Migrate test imports to use # prefix (Node subpath imports)
 *
 * Usage: node tests/lib/migrate-imports.mjs [--dry-run]
 *
 * Converts:
 *   - Relative paths (../../backend/...) to #backend/...
 *   - Old @ prefix (@backend/...) to #backend/...
 *
 * The # prefix works with package.json "imports" field for both
 * Node (Playwright) and Jest (via moduleNameMapper).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

// Patterns to convert
const patterns = [
  // === Convert old @ prefix to # prefix ===
  // @backend -> #backend
  {
    regex: /from\s+['"]@backend\/([^'"]+)['"]/g,
    replace: (match, path) => `from '#backend/${path}'`
  },
  {
    regex: /import\s*\(\s*['"]@backend\/([^'"]+)['"]\s*\)/g,
    replace: (match, path) => `import('#backend/${path}')`
  },
  {
    regex: /mockModule\s*\(\s*['"]@backend\/([^'"]+)['"]/g,
    replace: (match, path) => `mockModule('#backend/${path}'`
  },
  // @frontend -> #frontend
  {
    regex: /from\s+['"]@frontend\/([^'"]+)['"]/g,
    replace: (match, path) => `from '#frontend/${path}'`
  },
  {
    regex: /import\s*\(\s*['"]@frontend\/([^'"]+)['"]\s*\)/g,
    replace: (match, path) => `import('#frontend/${path}')`
  },
  {
    regex: /mockModule\s*\(\s*['"]@frontend\/([^'"]+)['"]/g,
    replace: (match, path) => `mockModule('#frontend/${path}'`
  },
  // @extensions -> #extensions
  {
    regex: /from\s+['"]@extensions\/([^'"]+)['"]/g,
    replace: (match, path) => `from '#extensions/${path}'`
  },
  {
    regex: /import\s*\(\s*['"]@extensions\/([^'"]+)['"]\s*\)/g,
    replace: (match, path) => `import('#extensions/${path}')`
  },
  // @fixtures -> #fixtures
  {
    regex: /from\s+['"]@fixtures\/([^'"]+)['"]/g,
    replace: (match, path) => `from '#fixtures/${path}'`
  },
  {
    regex: /import\s*\(\s*['"]@fixtures\/([^'"]+)['"]\s*\)/g,
    replace: (match, path) => `import('#fixtures/${path}')`
  },
  // @testlib -> #testlib
  {
    regex: /from\s+['"]@testlib\/([^'"]+)['"]/g,
    replace: (match, path) => `from '#testlib/${path}'`
  },
  {
    regex: /import\s*\(\s*['"]@testlib\/([^'"]+)['"]\s*\)/g,
    replace: (match, path) => `import('#testlib/${path}')`
  },
  {
    regex: /mockModule\s*\(\s*['"]@testlib\/([^'"]+)['"]/g,
    replace: (match, path) => `mockModule('#testlib/${path}'`
  },

  // === Convert relative paths to # prefix ===
  // Relative backend imports
  {
    regex: /from\s+['"](\.\.\/)+(backend\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `from '#backend/${path.replace(/^backend\//, '')}'`
  },
  {
    regex: /import\s*\(\s*['"](\.\.\/)+(backend\/[^'"]+)['"]\s*\)/g,
    replace: (match, dots, path) => `import('#backend/${path.replace(/^backend\//, '')}')`
  },
  {
    regex: /mockModule\s*\(\s*['"](\.\.\/)+(backend\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `mockModule('#backend/${path.replace(/^backend\//, '')}'`
  },
  // Relative frontend imports
  {
    regex: /from\s+['"](\.\.\/)+(frontend\/src\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `from '#frontend/${path.replace(/^frontend\/src\//, '')}'`
  },
  {
    regex: /import\s*\(\s*['"](\.\.\/)+(frontend\/src\/[^'"]+)['"]\s*\)/g,
    replace: (match, dots, path) => `import('#frontend/${path.replace(/^frontend\/src\//, '')}')`
  },
  {
    regex: /mockModule\s*\(\s*['"](\.\.\/)+(frontend\/src\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `mockModule('#frontend/${path.replace(/^frontend\/src\//, '')}'`
  },
  // Relative _extensions imports
  {
    regex: /from\s+['"](\.\.\/)+(\_extensions\/[^'"]+)['"]/g,
    replace: (match, dots, path) => `from '#extensions/${path.replace(/^_extensions\//, '')}'`
  },
  {
    regex: /import\s*\(\s*['"](\.\.\/)+(\_extensions\/[^'"]+)['"]\s*\)/g,
    replace: (match, dots, path) => `import('#extensions/${path.replace(/^_extensions\//, '')}')`
  },
  // Relative _fixtures imports
  {
    regex: /from\s+['"](\.\.\/)+(tests\/_fixtures\/[^'"]+|_fixtures\/[^'"]+)['"]/g,
    replace: (match, dots, path) => {
      const fixturePath = path.replace(/^(tests\/)?_fixtures\//, '');
      return `from '#fixtures/${fixturePath}'`;
    }
  },
  // Relative tests/lib imports
  {
    regex: /from\s+['"](\.\.\/)+(tests\/lib\/[^'"]+|lib\/[^'"]+)['"]/g,
    replace: (match, dots, path) => {
      // Only convert if it's the tests/lib, not backend/lib
      if (path.includes('tests/lib/') || (path.startsWith('lib/') && !path.includes('backend'))) {
        const libPath = path.replace(/^(tests\/)?lib\//, '');
        return `from '#testlib/${libPath}'`;
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
