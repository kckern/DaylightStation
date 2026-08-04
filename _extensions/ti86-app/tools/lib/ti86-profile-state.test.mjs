import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  encodeSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';
import {
  TI86_PROFILE_VARIABLES,
  Ti86ProfileMutationInterrupted,
  listTi86LearnerChoices,
  getTi86SelectedProgress,
  promoteTi86LearnerRoster,
  promoteTi86ProgressProjection,
  reconcileTi86LearnerSelection,
  selectTi86Learner,
} from './ti86-profile-state.mjs';

const deviceId = '86A001';

describe('TI-86 learner roster and soft-profile reference', () => {
  it('promotes the device-bound roster and exposes configured learners plus Guest', () => {
    const variables = fixture();
    expect(promoteTi86LearnerRoster(variables)).toMatchObject({
      promoted: true,
      trace: ['delete:DSUSERS', 'write:DSUSERS', 'delete:DSUSRNEW'],
    });
    expect(listTi86LearnerChoices(variables)).toEqual([
      { learnerKey: 4, label: 'Alpha', persistent: true },
      { learnerKey: 9, label: 'Beta', persistent: true },
      { learnerKey: 0, label: 'Guest', persistent: false },
    ]);
    expect(selectTi86Learner(variables, { learnerKey: 9 })).toMatchObject({
      status: 'selected', learnerKey: 9,
      selection: { state: {
        selectedLearnerKey: 9,
        flags: SCHOOLCALC_LOCAL_FLAGS.learnerSelected,
      } },
    });
    expect(selectTi86Learner(variables, { learnerKey: 0 })).toMatchObject({
      status: 'selected', learnerKey: 0,
      selection: { state: { flags: SCHOOLCALC_LOCAL_FLAGS.learnerSelected } },
    });
  });

  it('records an explicit Guest choice instead of treating key zero as first boot', () => {
    const variables = fixture();
    expect(selectTi86Learner(variables, { learnerKey: 0 })).toMatchObject({
      status: 'unchanged', learnerKey: 0,
      selection: { state: { flags: SCHOOLCALC_LOCAL_FLAGS.learnerSelected } },
    });
    expect(selectTi86Learner(variables, { learnerKey: 0 }).status).toBe('unchanged');
  });

  it('converges after a cut at every roster replacement mutation', () => {
    const baseline = fixture();
    const result = promoteTi86LearnerRoster(baseline);
    const expected = fingerprint(baseline);
    for (let cut = 1; cut <= result.mutationCount; cut += 1) {
      const variables = fixture();
      expect(() => promoteTi86LearnerRoster(variables, { interruptAfterMutation: cut }))
        .toThrow(Ti86ProfileMutationInterrupted);
      if (variables.has(TI86_PROFILE_VARIABLES.stage)) promoteTi86LearnerRoster(variables);
      expect(fingerprint(variables), `cut after mutation ${cut}`).toEqual(expected);
    }
  });

  it('locks switching during an active session and preserves its immutable attribution key', () => {
    const variables = fixture({
      state: {
        generation: 1,
        flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive,
        selectedLearnerKey: 4,
        sessionLearnerKey: 4,
      },
    });
    promoteTi86LearnerRoster(variables);
    expect(selectTi86Learner(variables, { learnerKey: 9 })).toMatchObject({
      status: 'locked', learnerKey: 4, sessionLearnerKey: 4,
    });
    expect(selectTi86Learner(variables, { learnerKey: 4 }).status).toBe('unchanged');
  });

  it('falls back a retired profile to Guest only after its session is inactive', () => {
    const variables = fixture({
      profiles: [{ learnerKey: 9, label: 'Beta' }],
      state: { generation: 1, selectedLearnerKey: 4 },
    });
    promoteTi86LearnerRoster(variables);
    expect(reconcileTi86LearnerSelection(variables)).toMatchObject({
      status: 'selected', learnerKey: 0,
      selection: { state: { selectedLearnerKey: 0 } },
    });
  });

  it('rejects a corrupt or cross-device stage before changing the old roster', () => {
    const corrupt = fixture();
    corrupt.get(TI86_PROFILE_VARIABLES.stage)[8] ^= 1;
    const corruptBefore = fingerprint(corrupt);
    expect(() => promoteTi86LearnerRoster(corrupt)).toThrow(/checksum/);
    expect(fingerprint(corrupt)).toEqual(corruptBefore);

    const otherCodec = new Ti86SchoolCalcCodec();
    const foreign = fixture();
    foreign.set(TI86_PROFILE_VARIABLES.stage, otherCodec.encodeLearnerRoster({
      schema: 'school.calc.learner-roster/v1', deviceId: '86B002',
      generation: `sha256:${'b'.repeat(64)}`,
      profiles: [{ learnerKey: 4, label: 'Alpha' }],
    }));
    const foreignBefore = fingerprint(foreign);
    expect(() => promoteTi86LearnerRoster(foreign)).toThrow(/another calculator/);
    expect(fingerprint(foreign)).toEqual(foreignBefore);
  });

  it('promotes progress independently and resolves it through the remembered learner key', () => {
    const variables = fixture({ state: { generation: 1, selectedLearnerKey: 4 } });
    expect(promoteTi86ProgressProjection(variables)).toMatchObject({
      promoted: true,
      trace: ['delete:DSPROG', 'write:DSPROG', 'delete:DSPRGNEW'],
    });
    expect(getTi86SelectedProgress(variables)).toMatchObject({
      status: 'available', learnerKey: 4,
      progress: {
        summary: { scorePercent: 80 },
        recentScores: [{ correct: 4, total: 5, percent: 80 }],
        followUps: [{ kind: 'review', availability: 'ready', label: 'Review this quiz' }],
      },
    });
    selectTi86Learner(variables, { learnerKey: 0 });
    expect(getTi86SelectedProgress(variables)).toMatchObject({
      status: 'guest', learnerKey: 0, progress: null,
    });
  });

  it('converges after a cut at every progress replacement mutation', () => {
    const baseline = fixture();
    const result = promoteTi86ProgressProjection(baseline);
    const expected = fingerprint(baseline);
    for (let cut = 1; cut <= result.mutationCount; cut += 1) {
      const variables = fixture();
      expect(() => promoteTi86ProgressProjection(variables, { interruptAfterMutation: cut }))
        .toThrow(Ti86ProfileMutationInterrupted);
      if (variables.has(TI86_PROFILE_VARIABLES.progressStage)) {
        promoteTi86ProgressProjection(variables);
      }
      expect(fingerprint(variables), `progress cut after mutation ${cut}`).toEqual(expected);
    }
  });

  it('rejects corrupt or cross-device progress before changing the prior snapshot', () => {
    const corrupt = fixture();
    corrupt.get(TI86_PROFILE_VARIABLES.progressStage)[8] ^= 1;
    const before = fingerprint(corrupt);
    expect(() => promoteTi86ProgressProjection(corrupt)).toThrow(/checksum/);
    expect(fingerprint(corrupt)).toEqual(before);

    const foreign = fixture();
    foreign.set(TI86_PROFILE_VARIABLES.progressStage, progressRecord({ deviceId: '86B002' }));
    const foreignBefore = fingerprint(foreign);
    expect(() => promoteTi86ProgressProjection(foreign)).toThrow(/another calculator/);
    expect(fingerprint(foreign)).toEqual(foreignBefore);
  });
});

function fixture({
  profiles = [{ learnerKey: 4, label: 'Alpha' }, { learnerKey: 9, label: 'Beta' }],
  state = { generation: 1 },
} = {}) {
  const codec = new Ti86SchoolCalcCodec();
  const oldRoster = codec.encodeLearnerRoster({
    schema: 'school.calc.learner-roster/v1', deviceId,
    generation: `sha256:${'a'.repeat(64)}`,
    profiles: [{ learnerKey: 4, label: 'Old Alpha' }],
  });
  const nextRoster = codec.encodeLearnerRoster({
    schema: 'school.calc.learner-roster/v1', deviceId,
    generation: `sha256:${'b'.repeat(64)}`, profiles,
  });
  return new Map([
    [TI86_PROFILE_VARIABLES.identity, codec.encodeDeviceIdentity({ deviceId })],
    [TI86_PROFILE_VARIABLES.canonical, Buffer.from(oldRoster)],
    [TI86_PROFILE_VARIABLES.stage, Buffer.from(nextRoster)],
    [TI86_PROFILE_VARIABLES.progressCanonical, progressRecord({ scorePercent: 50 })],
    [TI86_PROFILE_VARIABLES.progressStage, progressRecord({ scorePercent: 80 })],
    ['DSLOCAL0', encodeSchoolCalcLocalState(state)],
  ]);
}

function progressRecord({ deviceId: recordDeviceId = deviceId, scorePercent = 80 } = {}) {
  const codec = new Ti86SchoolCalcCodec();
  const correct = scorePercent === 80 ? 4 : 1;
  const total = scorePercent === 80 ? 5 : 2;
  return codec.encodeProgressProjection({
    schema: 'school.calc.progress-projection/v1', deviceId: recordDeviceId,
    generation: `sha256:${scorePercent === 80 ? 'c' : 'd'}`.padEnd(71, scorePercent === 80 ? 'c' : 'd'),
    profiles: [{
      learnerKey: 4, learnerId: 'kid-a', label: 'Alpha',
      summary: {
        evidenceCount: 2, engagementCount: 2, responseCount: total,
        correctCount: correct, completionCount: 1, activityCount: 1,
        assessmentCount: 1, scorePercent,
        lastActivityAt: '2026-08-01T18:00:00.000Z',
      },
      recentScores: [{
        activityKind: 'quiz', occurredAt: '2026-08-01T18:00:00.000Z',
        verification: 'verified', score: { correct, total, percent: scorePercent },
      }],
      followUps: [{
        actionId: 'review:kid-a:quiz-1', kind: 'review', label: 'Review this quiz',
        availability: 'ready', target: { type: 'bank', id: 'quiz-1' }, priority: 30,
      }],
    }],
  });
}

function fingerprint(variables) {
  return [...variables.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bytes]) => `${name}:${Buffer.from(bytes).toString('hex')}`);
}
