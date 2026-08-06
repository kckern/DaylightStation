#!/usr/bin/env node
/**
 * school-catalog — validate the published curriculum catalog.
 *
 * The promotion gate, on the command line. Runtime serves only a published,
 * reviewed catalog (spec §3), so before anything is promoted this asks the one
 * question that matters: does every unit, document, and manifest in
 * `<dataDir>/content/school/curriculum/` parse, validate, and resolve?
 *
 * Exit 1 on any error makes it usable as a CI gate. The shell is deliberately
 * thin — wiring plus a report; every rule lives in ValidateCatalog and the
 * domain validators, which carry their own tests.
 *
 * Usage:
 *   node cli/school-catalog.cli.mjs validate [--data-dir <path>] [--render-probe]
 *
 * Flags:
 *   --data-dir <path>  data directory to validate (default: $DAYLIGHT_BASE_PATH/data,
 *                      or /usr/src/app/data inside the container). Reads the tree
 *                      directly, so it also works against a bare fixture catalog
 *                      that has no households/users for ConfigService to load.
 *   --render-probe     additionally push every valid `target: letter` document
 *                      through the renderer's measure pass. Requires
 *                      `#rendering/school/documents/measure.mjs` to export
 *                      `probeDocument(document)`; until that lands (plan Task
 *                      B4) the flag reports the probe as unavailable and fails.
 *   --help, -h         show this message
 *
 * Exit codes:
 *   0  catalog is clean
 *   1  validation errors, or the run could not be completed
 *   2  usage error
 *
 * Manual run:
 *   node cli/school-catalog.cli.mjs validate
 *   node cli/school-catalog.cli.mjs validate --data-dir /tmp/fixture-data
 *
 * @module cli/school-catalog
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { parseArgv } from './_argv.mjs';
import { getConfigService } from './_bootstrap.mjs';
import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';
import { ValidateCatalog } from '#apps/school/usecases/ValidateCatalog.mjs';
import { PortalSurface } from '#apps/donow/surfaces/PortalSurface.mjs';
import { ThermalSurface } from '#apps/donow/surfaces/ThermalSurface.mjs';
import { LaserSurface } from '#apps/donow/surfaces/LaserSurface.mjs';
import { PlaybackHubSurface } from '#apps/donow/surfaces/PlaybackHubSurface.mjs';
import { LivingroomTvSurface } from '#apps/donow/surfaces/LivingroomTvSurface.mjs';
import { GarageFitnessSurface } from '#apps/donow/surfaces/GarageFitnessSurface.mjs';
import { PianoKioskSurface } from '#apps/donow/surfaces/PianoKioskSurface.mjs';

/**
 * The closed DoNow surface registry, for `validateAction` ONLY — no live
 * seam (eventBus, printers, wakeAndLoadService, ...) is wired, because this
 * CLI validates a catalog against a bare data dir with no household/config
 * graph to build one from (see `cmdValidate`'s own `--data-dir` note). Every
 * surface's `validateAction` is a pure, dependency-free check of the payload
 * shape — none of them touch an injected dep — so a bare instance is exactly
 * as correct here as the real, composed one `5_composition/modules/donow.mjs`
 * builds at runtime. This is the CLI's OWN small mirror of that closed set,
 * kept in sync by hand (same posture as `categories.mjs`): a `launch:` unit
 * naming a surface not in this list fails validation here exactly like an
 * unregistered surface would at runtime.
 */
function surfaceValidatorsForCli() {
  const surfaces = [
    new PortalSurface(), new ThermalSurface(), new LaserSurface(),
    new PlaybackHubSurface(), new LivingroomTvSurface(), new GarageFitnessSurface(),
    new PianoKioskSurface(),
  ];
  return new Map(surfaces.map((s) => [s.id, (raw) => s.validateAction(raw)]));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// quiet: the report is the output; a dotenv banner on stdout is noise in CI.
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const HELP = `school-catalog — validate the published curriculum catalog

Usage:
  school-catalog.cli.mjs validate [--data-dir <path>] [--render-probe]

Flags:
  --data-dir <path>  data directory to validate (default: $DAYLIGHT_BASE_PATH/data)
  --render-probe     also measure-pass every valid letter-target document
  --help, -h         show this message

Exit 1 on any error, so this can gate CI.
`;

/**
 * Resolve the render probe. It is a CONTRACT, not a guess: the rendering layer
 * owns page measurement, so the CLI asks for one named export and reports
 * plainly when it is not there yet rather than half-wiring the measure pass.
 */
async function loadRenderProbe() {
  let mod;
  try {
    mod = await import('#rendering/school/documents/measure.mjs');
  } catch {
    return null;
  }
  return typeof mod.probeDocument === 'function' ? mod.probeDocument : null;
}

function reportFileErrors(label, byId) {
  const ids = Object.keys(byId).sort();
  if (!ids.length) return;
  process.stdout.write(`\n${label}\n`);
  for (const id of ids) {
    process.stdout.write(`  ${id}\n`);
    for (const message of byId[id]) process.stdout.write(`    - ${message}\n`);
  }
}

function report(result, { dataDir }) {
  const { summary } = result;
  process.stdout.write(`Curriculum catalog: ${path.join(dataDir, 'content', 'school', 'curriculum')}\n`);
  process.stdout.write(`  units      ${String(summary.units).padStart(4)}  (${summary.publishable} publishable)\n`);
  process.stdout.write(`  documents  ${String(summary.documents).padStart(4)}\n`);
  process.stdout.write(`  manifests  ${String(summary.manifests).padStart(4)}\n`);

  if (result.catalogErrors.length) {
    process.stdout.write('\nunreadable files\n');
    for (const message of result.catalogErrors) process.stdout.write(`  - ${message}\n`);
  }
  reportFileErrors('units', result.unitErrors);
  reportFileErrors('documents', result.documentErrors);
  reportFileErrors('manifests', result.manifestErrors);

  if ((result.historyDrift ?? []).length) {
    process.stdout.write('\nHISTORY DRIFT (advisory) — recorded sessions reference unitIds this catalog no longer resolves.\n');
    process.stdout.write('These grades will appear FLAGGED (not counted into any course) on report cards:\n');
    for (const unitId of result.historyDrift) process.stdout.write(`  - ${unitId}\n`);
  }

  process.stdout.write(result.ok ? '\nOK — catalog is clean\n' : '\nFAILED — catalog is not promotable\n');
}

async function cmdValidate({ dataDirFlag, renderProbe }) {
  // With --data-dir the CLI is pointed at a bare tree (a fixture catalog, a
  // clone, a candidate export) that has no households/users to validate, so a
  // full ConfigService would refuse to start. Both datastores need exactly one
  // method, and this file IS the composition root for this process.
  const configService = dataDirFlag
    ? { getDataDir: () => path.resolve(dataDirFlag) }
    : await getConfigService();

  let measureProbe = null;
  if (renderProbe) {
    measureProbe = await loadRenderProbe();
    if (!measureProbe) {
      process.stderr.write(
        'ERROR: --render-probe requested but no probe is available.\n'
        + '       Expected probeDocument() from #rendering/school/documents/measure.mjs.\n',
      );
      return EXIT_FAIL;
    }
  }

  const useCase = new ValidateCatalog({
    catalog: new YamlCurriculumDatastore({ configService }),
    bankIds: new YamlSchoolDatastore({ configService }).listBankIds(),
    surfaceValidators: surfaceValidatorsForCli(),
    measureProbe,
    // Reverse sweep (admin advocacy A2): recorded-session unitIds, roster-wide.
    // Bare --data-dir trees have no user shards; the thunk degrades to none.
    recordedUnitIds: async () => {
      try {
        const { YamlWorkSessionDatastore } = await import('#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs');
        const sessions = new YamlWorkSessionDatastore({ configService });
        const usersDir = path.join(configService.getDataDir(), 'users');
        const learnerIds = fs.existsSync(usersDir)
          ? fs.readdirSync(usersDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
          : [];
        const ids = [];
        for (const learnerId of learnerIds) {
          // eslint-disable-next-line no-await-in-loop
          const rows = await sessions.listForLearner(learnerId).catch(() => []);
          rows.forEach((r) => { if (r.unitId) ids.push(r.unitId); });
        }
        return ids;
      } catch { return []; }
    },
  });

  const result = await useCase.execute({ renderProbe });
  report(result, { dataDir: configService.getDataDir() });
  return result.ok ? EXIT_OK : EXIT_FAIL;
}

async function main() {
  const { subcommand, flags, help } = parseArgv(process.argv.slice(2));
  if (help || !subcommand) {
    process.stdout.write(HELP);
    return help ? EXIT_OK : EXIT_USAGE;
  }
  if (subcommand !== 'validate') {
    process.stderr.write(`Unknown command: ${subcommand}\n\n`);
    process.stdout.write(HELP);
    return EXIT_USAGE;
  }
  const dataDirFlag = flags['data-dir'];
  if (dataDirFlag === true) {
    process.stderr.write('ERROR: --data-dir needs a path\n');
    return EXIT_USAGE;
  }
  return cmdValidate({ dataDirFlag, renderProbe: flags['render-probe'] === true });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(EXIT_FAIL);
  });
