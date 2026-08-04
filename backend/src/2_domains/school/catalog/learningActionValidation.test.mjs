import { describe, expect, it } from 'vitest';
import { LEARNING_ACTION_KINDS, validateLearningAction } from './learningActionValidation.mjs';

describe('School learning-action contract', () => {
  it('accepts only the two provider-neutral repeatable v1 effects', () => {
    expect(LEARNING_ACTION_KINDS).toEqual(['print_document', 'launch_media']);
    expect(validateLearningAction({
      schema: 'school.learning-action/v1',
      actionId: 'worksheet:velocity',
      title: 'Print velocity worksheet',
      kind: 'print_document',
      enabled: true,
      tokenVersion: 1,
      policy: { replay: 'repeatable' },
      target: { printableId: 'velocity-practice', copies: 1 },
    })).toMatchObject({ errors: [], action: { kind: 'print_document', enabled: true } });
    expect(validateLearningAction({
      schema: 'school.learning-action/v1',
      actionId: 'video:velocity',
      title: 'Launch velocity video',
      kind: 'launch_media',
      tokenVersion: 2,
      policy: { replay: 'repeatable' },
      target: { contentCode: 'living-room:media:velocity-intro' },
    })).toMatchObject({ errors: [], action: { kind: 'launch_media', enabled: true } });
  });

  it('rejects arbitrary commands, hidden authority, and expiring persistent artifacts', () => {
    const result = validateLearningAction({
      schema: 'school.learning-action/v1',
      actionId: 'unsafe', title: 'Unsafe', kind: 'command', tokenVersion: 0,
      policy: { replay: 'single_use', role: 'admin' },
      target: { command: 'rm', url: 'https://example.test' },
      learnerId: 'kid1', provider: 'plex', expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(result.errors).toContain('kind: must be one of print_document|launch_media');
    expect(result.errors).toContain('tokenVersion: must be an integer from 1–65535');
    expect(result.errors).toContain('policy.replay: must be repeatable for a persistent v1 lesson action');
    expect(result.errors).toContain('policy: contains unsupported fields: role');
    expect(result.errors).toContain('learnerId: is server/runtime policy and must not be authored here');
    expect(result.errors).toContain('provider: is server/runtime policy and must not be authored here');
    expect(result.errors).toContain('expiresAt: is server/runtime policy and must not be authored here');
  });

  it('rejects recursive School scans and unknown target fields', () => {
    const result = validateLearningAction({
      schema: 'school.learning-action/v1', actionId: 'loop', title: 'Loop',
      kind: 'launch_media', tokenVersion: 1, policy: { replay: 'repeatable' },
      target: { contentCode: 'sch:AAAAAAAAAAAAAAAA', provider: 'hidden' },
    });
    expect(result.errors).toContain('target.contentCode: must not recurse into the School scan namespace');
    expect(result.errors).toContain('target: contains unsupported fields: provider');
  });
});
