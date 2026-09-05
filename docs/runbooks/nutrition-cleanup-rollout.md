# Nutrition cleanup rollout

Implementation does not enable automation or modify production nutrition data.

1. Before upgrading the deployed Node/SDK set, stop the **single** backend and take
   a consistent backup of the existing `data/agents` SQLite files (including WAL/SHM
   if present) and user nutrition/state YAML. Do not back up only the main SQLite
   file while a writer is running. Keep the old image and lockfiles for rollback.
2. Build/install using Node 22.23.2 and the committed lockfiles. Do not test by
   starting a second household backend on a different port. That would still control
   real devices. Isolated Vitest suites and the static Playwright fixture server
   exercise this feature without the household process.
3. Start one upgraded backend. Verify `/api/v1/health/nutrition/cleanup` returns
   `enabled: false`, `dryRun: true` for a new user. Missing Telegram configuration
   must not prevent access. Check structured startup errors before activation.
4. In Health Settings, use **Preview cleanup now**. Inspect recent scan proposals
   and skips. For the original fish-taco incident, unknown artwork is not evidence
   for reallocating grams; the 310-kcal receipt must not be silently re-estimated.
   The protein-shake barcode capture must remain pending until serving/label
   confirmation. The agent cannot infer an unknown consumed amount.
5. Once preview behavior is reviewed, the user can switch off preview-only and
   explicitly enable automatic cleanup. Telegram questions are independently
   optional. Confirm a question in Health and check the existing Telegram message
   updates in place; then exercise a Telegram reply and observe it resolving in
   Health. Check the normal report synchronizer after a committed repair.
6. To pause, turn off Automatic cleanup. Active runs lose their commit authority.
   Previously opened questions can still be answered explicitly. Review receipts
   before Undo; conflicts require manual edits instead of overwriting newer data.

Rollback the application image/Node/lockfiles together. If the SDK migrated an old
memory database, restore its consistent pre-upgrade backup as a set. Do not delete
new nutrition audit receipts or replay whole old nutrition backups over subsequent
user edits; use version-checked Undo for individual food changes.

Verification entry points:

```sh
node node_modules/vitest/vitest.mjs run tests/isolated/adapters/agents backend/src/3_applications/nutrition frontend/src/modules/Health/cleanup tests/isolated/api/health-contract.test.mjs
node scripts/audit-layer-imports.mjs
node scripts/audit-ui-tokens.mjs
npm run build --prefix frontend
node node_modules/@playwright/test/cli.js test --config=playwright.health-review.config.mjs
```

The Playwright config starts only a static frontend preview with fixture API
interception. Build must finish **before** running those journeys.
