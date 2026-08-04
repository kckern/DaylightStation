import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRemediationSessionId,
  createRemediationTurnId,
  createLearningProbeEvidenceId,
  createLearningReflectionEvidenceId,
  createSchoolLearningLoop,
} from './schoolLearning.mjs';

describe('shared School learning-loop composition', () => {
  it('wires one surface-neutral durable loop beneath the School app state root', () => {
    const configService = {
      getHouseholdAppPath: (app, relative) => path.join('/state', app, relative),
    };
    const loop = createSchoolLearningLoop({
      configService,
      randomBytesFactory: () => Buffer.alloc(8, 0xab),
    });
    expect(loop).toMatchObject({
      sessions: expect.any(Object), offers: expect.any(Object),
      tutor: expect.any(Object), followUps: expect.any(Object),
      probeInteractions: null,
    });
  });

  it('wires idempotent probe interactions when shared School evidence is available', () => {
    const loop = createSchoolLearningLoop({
      configService: { getHouseholdAppPath: (app, relative) => path.join('/state', app, relative) },
      evidenceRepository: { appendEvidence: () => {}, listEvidence: () => [] },
      learnerDirectory: { hasLearner: () => true },
    });
    expect(loop.probeInteractions).toBeInstanceOf(Object);
    expect(createLearningProbeEvidenceId({ observationId: 'session:q1:1:feedback', learnerId: 'kid-a' }))
      .toBe(createLearningProbeEvidenceId({ observationId: 'session:q1:1:feedback', learnerId: 'kid-a' }));
    expect(createLearningReflectionEvidenceId({ observationId: 'session:reflection', learnerId: 'kid-a' }))
      .toBe(createLearningReflectionEvidenceId({ observationId: 'session:reflection', learnerId: 'kid-a' }));
  });

  it('uses source-stable session identity and independent random turn identity', () => {
    const input = {
      learnerId: 'kid-a',
      source: { surface: 'web', externalId: 'assessment-1' },
    };
    expect(createRemediationSessionId(input)).toBe(createRemediationSessionId(input));
    expect(createRemediationSessionId(input)).not.toBe(createRemediationSessionId({
      ...input, source: { surface: 'schoolcalc', externalId: 'assessment-1' },
    }));
    expect(createRemediationTurnId(() => Buffer.alloc(8, 0xab))).toBe('TURN_ABABABABABABABAB');
  });
});
