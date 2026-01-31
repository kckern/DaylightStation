// scripts/update-test-imports.mjs
// Updates import paths in test files to use the new alias-based structure
//
// Usage: node scripts/update-test-imports.mjs [--dry-run]

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const DRY_RUN = process.argv.includes('--dry-run');

const IMPORT_REWRITES = [
  // Old lib paths -> #testlib
  [/@testlib\/testDataService\.mjs/g, '#testlib/testDataService.mjs'],
  [/['"]\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "'#testlib/testDataService.mjs'"],
  [/['"]\.\.\/\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "'#testlib/testDataService.mjs'"],
  [/['"]\.\.\/lib\/testDataService\.mjs['"]/g, "'#testlib/testDataService.mjs'"],
  [/['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "'#testlib/testDataService.mjs'"],

  // Old _lib relative paths -> #testlib
  [/['"]\.\.\/_lib\/([^'"]+)['"]/g, "'#testlib/$1'"],
  [/['"]\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "'#testlib/$1'"],
  [/['"]\.\.\/\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "'#testlib/$1'"],
  [/['"]\.\.\/\.\.\/\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "'#testlib/$1'"],

  // Fixtures - relative paths -> #fixtures
  [/['"]\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "'#fixtures/$1'"],
  [/['"]\.\.\/\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "'#fixtures/$1'"],
  [/['"]\.\.\/\.\.\/\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "'#fixtures/$1'"],
  [/['"]\.\.\/_fixtures\/([^'"]+)['"]/g, "'#fixtures/$1'"],

  // Harnesses - relative paths -> #harnesses
  [/['"]\.\.\/\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "'#harnesses/$1'"],
  [/['"]\.\.\/\.\.\/\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "'#harnesses/$1'"],
  [/['"]\.\.\/\.\.\/\.\.\/\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "'#harnesses/$1'"],
  [/['"]\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "'#harnesses/$1'"],

  // Backend aliases are already correct - no changes needed
  // #system/, #domains/, #adapters/, #apps/, #api/
];

async function updateImports() {
  const testFiles = await glob('tests/**/*.test.mjs', {
    ignore: ['tests/_archive/**'],
  });

  console.log(`Found ${testFiles.length} test files`);
  if (DRY_RUN) {
    console.log('DRY RUN - no files will be modified\n');
  }

  let totalModified = 0;

  for (const file of testFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let originalContent = content;
    let modified = false;

    for (const [pattern, replacement] of IMPORT_REWRITES) {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
      }
    }

    if (content !== originalContent) {
      modified = true;
      totalModified++;

      if (DRY_RUN) {
        console.log(`Would update: ${file}`);
        // Show a preview of changes
        const originalLines = originalContent.split('\n');
        const newLines = content.split('\n');
        for (let i = 0; i < originalLines.length; i++) {
          if (originalLines[i] !== newLines[i]) {
            console.log(`  - ${originalLines[i].trim()}`);
            console.log(`  + ${newLines[i].trim()}`);
          }
        }
      } else {
        fs.writeFileSync(file, content);
        console.log(`Updated: ${file}`);
      }
    }
  }

  console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'} ${totalModified} files`);
}

updateImports().catch(console.error);
