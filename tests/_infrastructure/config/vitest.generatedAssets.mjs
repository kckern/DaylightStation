// Names gitignored generated assets this checkout lacks, once per vitest run.
// A fresh worktree (or any checkout that never ran the frontend prebuild) has
// no flags or Solar icons, so suites that draw them fail on a missing <svg>
// with nothing pointing at the cause. This only warns: most runs (backend,
// composition contracts in the pre-commit hook) never touch these assets, and
// the icon and flag registry tests already fail with the same hint.
import { missingSourceAssets } from '../../../frontend/scripts/prepare-public-assets.mjs';

function warning(missing) {
  return [
    '',
    '[generated-assets] warn: this checkout is missing generated assets:',
    ...missing.map((dir) => `  - ${dir}`),
    '  Icon and flag assertions will fail until you run `npm run prepare:assets` in frontend/',
    '  (the frontend prebuild step; it writes only gitignored files).',
    '',
  ].join('\n');
}

export default function setup() {
  const missing = missingSourceAssets();
  if (!missing.length) return undefined;
  // CLI sink: the structured browser logger does not exist in the test runner process.
  process.stderr.write(`${warning(missing)}\n`);
  // Repeated at teardown so it lands beside the summary that shows the failures.
  return () => { process.stderr.write(`${warning(missing)}\n`); };
}
