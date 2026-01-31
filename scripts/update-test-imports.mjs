// scripts/update-test-imports.mjs
// Updates import paths in test files to use the new alias-based structure
//
// Usage: node scripts/update-test-imports.mjs [--dry-run]

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');

// Only match import/require statements, NOT path.resolve/path.join calls
const IMPORT_REWRITES = [
  // Old lib paths -> #testlib (import statements only)
  [/from ['"]\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "from '#testlib/testDataService.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "from '#testlib/testDataService.mjs'"],
  [/from ['"]\.\.\/lib\/testDataService\.mjs['"]/g, "from '#testlib/testDataService.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "from '#testlib/testDataService.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "from '#testlib/testDataService.mjs'"],

  // testDataMatchers
  [/from ['"]\.\.\/\.\.\/lib\/testDataMatchers\.mjs['"]/g, "from '#testlib/testDataMatchers.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/lib\/testDataMatchers\.mjs['"]/g, "from '#testlib/testDataMatchers.mjs'"],
  [/from ['"]\.\.\/lib\/testDataMatchers\.mjs['"]/g, "from '#testlib/testDataMatchers.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/testDataMatchers\.mjs['"]/g, "from '#testlib/testDataMatchers.mjs'"],

  // configHelper
  [/from ['"]\.\.\/\.\.\/lib\/configHelper\.mjs['"]/g, "from '#testlib/configHelper.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/lib\/configHelper\.mjs['"]/g, "from '#testlib/configHelper.mjs'"],
  [/from ['"]\.\.\/lib\/configHelper\.mjs['"]/g, "from '#testlib/configHelper.mjs'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/configHelper\.mjs['"]/g, "from '#testlib/configHelper.mjs'"],

  // Old _lib relative paths -> #testlib (import statements only)
  [/from ['"]\.\.\/_lib\/([^'"]+)['"]/g, "from '#testlib/$1'"],
  [/from ['"]\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "from '#testlib/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "from '#testlib/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "from '#testlib/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_lib\/([^'"]+)['"]/g, "from '#testlib/$1'"],

  // Fixtures - import statements only
  [/from ['"]\.\.\/_fixtures\/([^'"]+)['"]/g, "from '#fixtures/$1'"],
  [/from ['"]\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "from '#fixtures/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "from '#fixtures/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "from '#fixtures/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_fixtures\/([^'"]+)['"]/g, "from '#fixtures/$1'"],

  // Harnesses - import statements only
  [/from ['"]\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "from '#harnesses/$1'"],
  [/from ['"]\.\.\/\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "from '#harnesses/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "from '#harnesses/$1'"],
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/_infrastructure\/harnesses\/([^'"]+)['"]/g, "from '#harnesses/$1'"],

  // Backend aliases are already correct - no changes needed
  // #system/, #domains/, #adapters/, #apps/, #api/
];

function findTestFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip _archive directory
    if (entry.name === '_archive') continue;

    if (entry.isDirectory()) {
      findTestFiles(fullPath, files);
    } else if (entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }

  return files;
}

function updateImports() {
  const testsDir = path.resolve(process.cwd(), 'tests');
  const testFiles = findTestFiles(testsDir);

  console.log(`Found ${testFiles.length} test files`);
  if (DRY_RUN) {
    console.log('DRY RUN - no files will be modified\n');
  }

  let totalModified = 0;

  for (const file of testFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let originalContent = content;

    for (const [pattern, replacement] of IMPORT_REWRITES) {
      // Reset lastIndex before testing
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        // Reset again before replace
        pattern.lastIndex = 0;
        content = content.replace(pattern, replacement);
      }
    }

    if (content !== originalContent) {
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

updateImports();
