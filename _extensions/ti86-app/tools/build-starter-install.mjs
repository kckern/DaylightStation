#!/usr/bin/env node
/** Build one complete, preloaded offline SchoolCalc starter installation. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { YamlLearningCatalogRepository } from '../../../backend/src/1_adapters/school/catalog/YamlLearningCatalogRepository.mjs';
import { Ti86SchoolCalcCodec, decodeTi86Envelope } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { stableRecordDigest } from '../../../backend/src/3_applications/common/stableRecord.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';
import { encodeSchoolCalcLocalState, SCHOOLCALC_LOCAL_FLAGS } from './lib/schoolcalc-local-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'dist');
const CONTENT = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/school/catalog';
const DEVICE_ID = 'TI86A';
const ACCESS = Object.freeze({ learnerKeys: [1, 2, 3, 4], guest: true });
const codec = new Ti86SchoolCalcCodec();
const catalogs = new YamlLearningCatalogRepository({ directories: [path.join(CONTENT, 'catalogs')] });
const raw = await catalogs.getCatalog('schoolcalc-starter');
if (!raw) throw new Error('missing schoolcalc-starter catalog');
const pack = JSON.parse(readFileSync(path.join(CONTENT, 'ti86-packs', 'manifest.json'), 'utf8'));
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
write('DSINST0', manifest, 'SchoolCalc starter install state');
write('DSINST', manifest, 'SchoolCalc starter uplink state');
// Provision both alternating slots. Reinstalling over a previously launched
// client must replace any newer stale continuation instead of allowing it to
// outrank the starter Catalog/profile state.
write('DSLOCAL0', state0, 'SchoolCalc starter local state 1');
write('DSLOCAL1', state1, 'SchoolCalc starter local state 2');
writeFileSync(path.join(OUT, 'starter-install.json'), `${JSON.stringify({
  deviceId: DEVICE_ID, generation, catalogGenerationKey,
  variables: ['DSCAT0', 'DSINST0', 'DSINST', 'DSLOCAL0', 'DSLOCAL1'], artifacts,
}, null, 2)}\n`);
process.stdout.write(`[ti86] starter install: ${artifacts.length} lessons, SCC1 ${catalog.length} bytes, SCM1 ${manifest.length} bytes\n`);

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
  return Object.fromEntries([id, 'title', 'shortTitle', 'description', 'estimatedMinutes', 'tags']
    .filter((field) => node[field] !== undefined).map((field) => [field, node[field]]));
}

function write(name, record, comment) {
  writeFileSync(path.join(OUT, `${name}.86s`), createTi86StringFile({ name, record, comment }));
}
