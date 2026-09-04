#!/usr/bin/env node
/**
 * One-time saved-meal → template migration (PRD F6.3, Task 10.2).
 *
 *   node cli/migrate-saved-meals-to-templates.mjs [--user <id>] [--dry-run]
 *
 * Idempotent: a name a template already occupies is skipped, so a second run
 * is a no-op. It never deletes a saved meal — the meals endpoints stay as the
 * copy-day-to-today transport.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { initConfigService, configService } from '#system/config/index.mjs';
import { createSecretsProvider } from '#adapters/secrets/createSecretsProvider.mjs';
import { DataService } from '#adapters/persistence/files/DataService.mjs';
import { YamlSavedMealsDatastore } from '#adapters/persistence/yaml/YamlSavedMealsDatastore.mjs';
import { YamlMealTemplateDatastore } from '#adapters/persistence/yaml/YamlMealTemplateDatastore.mjs';
import { migrateSavedMealsToTemplates } from './migrateSavedMealsToTemplates.lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const userFlag = args.indexOf('--user');

const base = process.env.DAYLIGHT_BASE_PATH;
if (!base) throw new Error('DAYLIGHT_BASE_PATH must identify the Daylight data root');
await initConfigService(path.join(base, 'data'), { secretsProviderFactory: createSecretsProvider });

const userId = userFlag >= 0
  ? args[userFlag + 1]
  : (configService.getHeadOfHousehold?.() || configService.getDefaultUsername?.());
if (!userId) throw new Error('No user resolved — pass --user <id>');

const dataService = new DataService({ configService });
const summary = await migrateSavedMealsToTemplates({
  mealsStore: new YamlSavedMealsDatastore({ dataService }),
  templateStore: new YamlMealTemplateDatastore({ dataService }),
  userId,
  createId: uuidv4,
  nowIso: new Date().toISOString(),
  dryRun,
});

// A CLI's report is its whole product, so it goes to stdout deliberately —
// this is the tool's output, not diagnostic logging (which the migration
// function emits through the injected logger when one is supplied).
process.stdout.write(
  `saved-meal → template migration${dryRun ? ' (DRY RUN)' : ''} for ${userId}\n`
  + `  saved meals read : ${summary.total}\n`
  + `  templates created: ${summary.created}${summary.createdNames.length ? ` — ${summary.createdNames.join(', ')}` : ''}\n`
  + `  skipped          : ${summary.skipped}${summary.skippedNames.length ? ` — ${summary.skippedNames.join(', ')}` : ''}\n`
  + '  saved meals are left in place (copy-day-to-today transport)\n',
);
