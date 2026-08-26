#!/usr/bin/env node
/** Build one complete, preloaded offline SchoolCalc starter installation. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { YamlLearningCatalogRepository } from '../../../backend/src/1_adapters/school/catalog/YamlLearningCatalogRepository.mjs';
import { Ti86SchoolCalcCodec, decodeTi86Envelope } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { encodeTi86ContinuationCodebook } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86ContinuationCodebook.mjs';
import { stableRecordDigest } from '../../../backend/src/3_applications/common/stableRecord.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';
import { encodeSchoolCalcLocalState, SCHOOLCALC_LOCAL_FLAGS } from './lib/schoolcalc-local-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'dist');
const PACKS = path.join(OUT, 'content-packs');
const CONTENT = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/school/catalog';
const DEVICE_ID = 'TI86A';
const ACCESS = Object.freeze({ learnerKeys: [1, 2, 3, 4], guest: true });
const codec = new Ti86SchoolCalcCodec();
const catalogs = new YamlLearningCatalogRepository({ directories: [path.join(CONTENT, 'catalogs')] });
const raw = await catalogs.getCatalog('schoolcalc-starter');
if (!raw) throw new Error('missing schoolcalc-starter catalog');
// The preceding pack build owns the immutable artifacts used by this install.
// Never re-open a mounted/generated manifest: it can describe an older codec
// projection than the `.86s` files about to be transferred.
const pack = JSON.parse(readFileSync(path.join(PACKS, 'manifest.json'), 'utf8'));
const artifacts = pack.artifacts.map(({ fileName, ...artifact }) => artifact);
const artifactByAddress = new Map(artifacts.map((artifact) => [artifact.source.address, artifact]));

const projectionBody = {
  schema: 'school.calc.catalog-projection/v1', deviceId: DEVICE_ID, platformId: 'ti86', storage: {},
  catalogs: [projectCatalog(raw)],
};
const generation = `sha256:${stableRecordDigest(projectionBody)}`;
const projection = { ...projectionBody, generation };
const catalog = codec.encodeCatalog(projection);
const catalogGenerationKey = decodeTi86Envelope(catalog, 'SCC1').generationKey;
// WHO SITS IN WHICH SLOT IS HOUSEHOLD DATA, NOT SOURCE.
//
// This map used to name real learners inline. The repo is public, so the
// identities live in the (gitignored) data tree instead and the committed
// default is a placeholder set. The shape is what matters to the codebook:
// exactly four slots, 0..3, each with a distinct learnerKey 1..4 — see
// IssueSchoolContinuationCode, which rejects anything else.
//
// Override by creating `<dataDir>/household/config/schoolcalc.slots.json`:
//   { "<learnerId>": { "slot": 0, "learnerKey": 1 }, ... }
// Without it the build still succeeds and produces placeholder-labelled slots,
// which is correct for a STARTER image and wrong for a real one — so the run
// says out loud which of the two it made.
const DEFAULT_LEARNER_SLOTS = {
  learner1: { slot: 0, learnerKey: 1 },
  learner2: { slot: 1, learnerKey: 2 },
  learner3: { slot: 2, learnerKey: 3 },
  learner4: { slot: 3, learnerKey: 4 },
};
const slotsOverridePath = path.join(
  process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH || '', 'data'),
  'household/config/schoolcalc.slots.json',
);
let LEARNER_SLOTS = DEFAULT_LEARNER_SLOTS;
try {
  LEARNER_SLOTS = JSON.parse(readFileSync(slotsOverridePath, 'utf8'));
  process.stdout.write(`[ti86] learner slots from ${slotsOverridePath}\n`);
} catch {
  process.stdout.write('[ti86] no slot override found — building with PLACEHOLDER learner slots\n');
}

const continuationCodebook = encodeTi86ContinuationCodebook({
  deviceId: DEVICE_ID,
  generation,
  catalog: raw,
  artifacts,
  learnerSlots: LEARNER_SLOTS,
});
const manifest = codec.encodeSyncManifest({
  schema: 'school.calc.sync-plan/v1', deviceId: DEVICE_ID, platformId: 'ti86',
  generation: `sha256:${stableRecordDigest({ deviceId: DEVICE_ID, artifacts, generation })}`,
  catalog: { generation, changed: true }, ready: true, blockers: [], removals: [], artifacts,
  installedArtifacts: artifacts, acknowledgements: { sequences: [] }, deliveryAcknowledgements: { requestIds: [] },
});
const initialState = {
  flags: SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent,
  catalogGenerationKey, selectedLearnerKey: 0, view: 'home',
};
const state0 = encodeSchoolCalcLocalState({
  ...initialState, generation: 1,
});
const state1 = encodeSchoolCalcLocalState({
  ...initialState,
  generation: 2, flags: SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent,
});

mkdirSync(OUT, { recursive: true });
write('DSCAT0', catalog, 'SchoolCalc starter Catalog');
write('DSCODE', continuationCodebook, 'SchoolCalc offline continuation routes');
write('DSINST0', manifest, 'SchoolCalc starter install state');
write('DSINST', manifest, 'SchoolCalc starter uplink state');
// Provision both alternating slots. Reinstalling over a previously launched
// client must replace any newer stale continuation instead of allowing it to
// outrank the starter Catalog/profile state.
write('DSLOCAL0', state0, 'SchoolCalc starter local state 1');
write('DSLOCAL1', state1, 'SchoolCalc starter local state 2');
writeFileSync(path.join(OUT, 'starter-install.json'), `${JSON.stringify({
  deviceId: DEVICE_ID, generation, catalogGenerationKey,
  variables: ['DSCAT0', 'DSCODE', 'DSINST0', 'DSINST', 'DSLOCAL0', 'DSLOCAL1'], artifacts,
}, null, 2)}\n`);
process.stdout.write(`[ti86] starter install: ${artifacts.length} lessons, SCC1 ${catalog.length} bytes, SCCO ${continuationCodebook.length} bytes, SCM1 ${manifest.length} bytes\n`);

function projectCatalog(catalogDefinition) {
  return {
    ...header(catalogDefinition, 'catalogId'), access: ACCESS,
    subjects: catalogDefinition.subjects.map((subject) => ({
      ...header(subject, 'subjectId'), access: ACCESS,
      courses: subject.courses.map((course) => ({
        ...header(course, 'courseId'), access: ACCESS,
        units: course.units.map((unit) => ({
          ...header(unit, 'unitId'), access: ACCESS,
          lessons: unit.lessons.map((lesson) => {
            const address = [catalogDefinition.catalogId, subject.subjectId, course.courseId, unit.unitId, lesson.lessonId].join('/');
            const artifact = artifactByAddress.get(address);
            if (!artifact) throw new Error(`starter artifact is missing for ${address}`);
            return { ...header(lesson, 'lessonId'), address, access: ACCESS, state: 'installed', compatible: true,
              reasons: [], artifactId: artifact.artifactId, byteLength: artifact.byteLength, requiredCapabilities: [] };
          }),
        })),
      })),
    })),
  };
}

function header(node, id) {
  // The Catalog surface has one 128-pixel breadcrumb. Preserve an authored
  // shortTitle beside the full title so the generic TI-86 runtime can choose
  // it only where chrome is narrow, without subject-specific code.
  return Object.fromEntries([id, 'title', 'shortTitle', 'description', 'estimatedMinutes', 'tags']
    .filter((field) => node[field] !== undefined).map((field) => [field, node[field]]));
}

function write(name, record, comment) {
  writeFileSync(path.join(OUT, `${name}.86s`), createTi86StringFile({ name, record, comment }));
}
