#!/usr/bin/env node
/**
 * Report (default) or apply (--apply) the budget-range settings migration
 * (docs/_wip/plans/2026-09-24-health-budget-range-design.md, Phase 1).
 * Run inside the app container, from the app root, so data/ is the live tree:
 *
 *   node cli/health-budget-settings-migrate.cli.mjs --user <id>            # report only
 *   node cli/health-budget-settings-migrate.cli.mjs --user <id> --apply    # fill an unset budgetFloor
 *
 * Only ever writes data/users/<id>/apps/health/goals.yml, and only budgetFloor.
 */
import fs from 'node:fs';
import yaml from 'js-yaml';
import { planBudgetSettingsMigration } from '#apps/health/budgetSettingsMigration.mjs';

const args = process.argv.slice(2);
const user = args[args.indexOf('--user') + 1];
const apply = args.includes('--apply');
if (!args.includes('--user') || !user || user.startsWith('--')) {
  process.stderr.write('usage: --user <id> [--apply]\n');
  process.exit(2);
}

const read = (p) => (fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || {} : {});
const goalsPath = `data/users/${user}/apps/health/goals.yml`;
const healthGoals = read(goalsPath);
const plan = planBudgetSettingsMigration({
  healthGoals,
  profile: read(`data/users/${user}/profile.yml`),
  coachGoals: read(`data/users/${user}/agents/health-coach/goals.yml`),
  coachingConfig: read('data/household/coaching/config.yml'),
  today: new Date().toLocaleDateString('en-CA'),
});
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
if (apply && Object.keys(plan.set).length) {
  fs.writeFileSync(goalsPath, yaml.dump({ ...healthGoals, ...plan.set }));
  process.stdout.write(`applied: ${JSON.stringify(plan.set)} -> ${goalsPath}\n`);
} else if (apply) {
  process.stdout.write('nothing to apply\n');
}
