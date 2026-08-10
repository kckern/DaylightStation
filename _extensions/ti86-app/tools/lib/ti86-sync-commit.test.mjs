import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  decodeTi86Envelope,
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { encodeSchoolCalcLocalState } from './schoolcalc-local-state.mjs';
import {
  TI86_SYNC_VARIABLES,
  Ti86SyncCommitInterrupted,
  commitTi86StagedSync,
  inspectTi86CommittedSync,
} from './ti86-sync-commit.mjs';

const deviceId = '86A001';

describe('TI-86 staged sync commit reference', () => {
  it('commits Catalog/install snapshots, acknowledgements, and removals atomically', () => {
    const fixture = stagedFixture();
    const result = commitTi86StagedSync(fixture.variables);
    expect(result).toMatchObject({
      committed: true,
      alreadyCommitted: false,
      installedArtifactIds: [fixture.next.artifactId],
    });
    expect(result.trace).toEqual([
      'write:DSCAT0',
      'write:DSINST0',
      'queue:delete-canonical',
      'write:DSLOCAL1',
      'write:DSINST',
      `delete:${fixture.old.variableName}`,
      'delete:DSCATNEW',
      'delete:DSACKNEW',
      'delete:DSSYNC',
    ]);
    expect(fixture.variables.has(fixture.old.variableName)).toBe(false);
    expect(fixture.variables.has(fixture.next.variableName)).toBe(true);
    expect(fixture.variables.has(TI86_SYNC_VARIABLES.queue)).toBe(false);
    expect(fixture.variables.has(TI86_SYNC_VARIABLES.manifestStage)).toBe(false);

    const committed = inspectTi86CommittedSync(fixture.variables);
    expect(committed.localSelection).toMatchObject({
      activeSlot: 'DSLOCAL1',
      state: { generation: 2, catalogGenerationKey: fixture.catalogGenerationKey },
    });
    expect(committed.catalog.slot).toBe(0);
    expect(committed.installed.slot).toBe(0);
    expect(committed.installed.value.installedArtifacts.map((entry) => entry.artifactId))
      .toEqual([fixture.next.artifactId]);
    expect(fixture.variables.get(TI86_SYNC_VARIABLES.installedStateUplink)
      .equals(committed.installed.bytes)).toBe(true);
  });

  it('converges after a power cut at every durable mutation boundary', () => {
    const baselineFixture = stagedFixture();
    const baselineResult = commitTi86StagedSync(baselineFixture.variables);
    const expected = fingerprint(baselineFixture.variables);

    for (let cut = 1; cut <= baselineResult.mutationCount; cut += 1) {
      const fixture = stagedFixture();
      expect(() => commitTi86StagedSync(fixture.variables, { interruptAfterMutation: cut }))
        .toThrow(Ti86SyncCommitInterrupted);
      if (fixture.variables.has(TI86_SYNC_VARIABLES.manifestStage)) {
        commitTi86StagedSync(fixture.variables);
      } else {
        // Losing DSSYNC is the final mutation, after the committed alternating
        // snapshots, derived uplink, removals, and staging cleanup are durable.
        inspectTi86CommittedSync(fixture.variables);
      }
      expect(fingerprint(fixture.variables), `cut after mutation ${cut}`).toEqual(expected);
    }
  });

  it('rejects corrupt or mismatched staged records before changing any variable', () => {
    const corruptArtifact = stagedFixture();
    corruptArtifact.variables.get(corruptArtifact.next.variableName)[12] ^= 1;
    const artifactBefore = fingerprint(corruptArtifact.variables);
    expect(() => commitTi86StagedSync(corruptArtifact.variables)).toThrow(/does not match DSSYNC|checksum/);
    expect(fingerprint(corruptArtifact.variables)).toEqual(artifactBefore);

    const wrongAck = stagedFixture();
    wrongAck.variables.set(TI86_SYNC_VARIABLES.acknowledgementStage,
      wrongAck.codec.encodeAcknowledgements({ deviceId, sequences: [18] }));
    const ackBefore = fingerprint(wrongAck.variables);
    expect(() => commitTi86StagedSync(wrongAck.variables)).toThrow(/DSACKNEW/);
    expect(fingerprint(wrongAck.variables)).toEqual(ackBefore);

    const missingCatalog = stagedFixture();
    missingCatalog.variables.delete(TI86_SYNC_VARIABLES.catalogStage);
    const catalogBefore = fingerprint(missingCatalog.variables);
    expect(() => commitTi86StagedSync(missingCatalog.variables)).toThrow(/DSCATNEW/);
    expect(fingerprint(missingCatalog.variables)).toEqual(catalogBefore);
  });

  it('rejects a blocked plan before applying Catalog, queue, or artifact mutations', () => {
    const fixture = stagedFixture({ ready: false });
    const before = fingerprint(fixture.variables);
    expect(() => commitTi86StagedSync(fixture.variables)).toThrow(/plan is blocked/);
    expect(fingerprint(fixture.variables)).toEqual(before);
    expect(fixture.variables.has(fixture.old.variableName)).toBe(true);
    expect(fixture.variables.has(fixture.next.variableName)).toBe(false);
    expect(fixture.variables.has(TI86_SYNC_VARIABLES.queue)).toBe(true);
  });

  it('retains the entire immutable queue when only a partial batch is acknowledged', () => {
    const fixture = stagedFixture({
      queueSequences: [17, 18], acknowledgementSequences: [17],
    });
    const before = Buffer.from(fixture.variables.get(TI86_SYNC_VARIABLES.queue));
    commitTi86StagedSync(fixture.variables);
    expect(fixture.variables.get(TI86_SYNC_VARIABLES.queue).equals(before)).toBe(true);
  });
});

function stagedFixture({
  ready = true,
  queueSequences = [17],
  acknowledgementSequences = queueSequences,
} = {}) {
  const codec = new Ti86SchoolCalcCodec();
  const old = codec.compile(bundle('old'));
  const next = codec.compile(bundle('next'));
  const catalogGeneration = `sha256:${'c'.repeat(64)}`;
  const catalog = codec.encodeCatalog({
    schema: 'school.calc.catalog-projection/v1',
    deviceId,
    platformId: 'ti86',
    generation: catalogGeneration,
    storage: {},
    catalogs: [{ catalogId: 'main', title: 'Main', subjects: [] }],
  });
  const results = queueSequences.map((sequence) => encodeTi86ResultRecord({
    schema: 'school.calc.result/v1', kind: 'responses', deviceId, sequence, learnerKey: 4,
    artifactId: old.artifactId, moduleIndex: 0,
    responses: [{ itemIndex: 0, given: 1 }],
    localScore: { correct: 1, total: 1, percent: 100 },
  }));
  const acknowledgement = codec.encodeAcknowledgements({
    deviceId, sequences: acknowledgementSequences,
  });
  const manifest = codec.encodeSyncManifest({
    schema: 'school.calc.sync-plan/v1',
    deviceId,
    platformId: 'ti86',
    generation: `sha256:${'d'.repeat(64)}`,
    catalog: { generation: catalogGeneration, changed: true },
    ready,
    blockers: ready ? [] : [{ code: 'INSUFFICIENT_STAGING_STORAGE' }],
    removals: [old],
    artifacts: [next],
    installedArtifacts: ready ? [next] : [old],
    acknowledgements: { sequences: acknowledgementSequences },
  });
  const variables = new Map([
    [TI86_SYNC_VARIABLES.identity, codec.encodeDeviceIdentity({ deviceId })],
    ['DSLOCAL0', encodeSchoolCalcLocalState({ generation: 1 })],
    [old.variableName, old.bytes],
    [TI86_SYNC_VARIABLES.catalogStage, catalog],
    [TI86_SYNC_VARIABLES.acknowledgementStage, acknowledgement],
    [TI86_SYNC_VARIABLES.manifestStage, manifest],
    [TI86_SYNC_VARIABLES.queue, encodeTi86ResultQueue({ deviceId, records: results })],
    ...(ready ? [[next.variableName, next.bytes]] : []),
  ].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  return {
    codec, variables, old, next, catalogGeneration,
    catalogGenerationKey: decodeTi86Envelope(catalog, 'SCC1').generationKey,
  };
}

function bundle(suffix) {
  return {
    schema: 'school.learning-lesson/v1',
    address: `main/mixed/course/unit/${suffix}`,
    context: {
      catalog: { catalogId: 'main', title: 'Main' },
      subject: { subjectId: 'mixed', title: 'Mixed' },
      course: { courseId: 'course', title: 'Course' },
      unit: { unitId: 'unit', title: 'Unit' },
    },
    lesson: {
      lessonId: suffix,
      title: `Lesson ${suffix}`,
      objectives: [],
      modules: [{
        moduleId: 'notes', type: 'lecture_notes', documentId: `notes-${suffix}`,
        document: {
          schema: 'school.learning-document/v1', documentId: `notes-${suffix}`,
          title: `Notes ${suffix}`,
          blocks: [{ blockId: 'content', type: 'prose', text: `Content ${suffix}` }],
        },
      }],
    },
    capabilities: ['reader@1'],
  };
}

function fingerprint(variables) {
  return [...variables.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bytes]) => `${name}:${Buffer.from(bytes).toString('hex')}`);
}
