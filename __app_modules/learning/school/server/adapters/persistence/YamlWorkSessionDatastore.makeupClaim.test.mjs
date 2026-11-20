import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { YamlWorkSessionDatastore } from './YamlWorkSessionDatastore.mjs';

describe('YamlWorkSessionDatastore makeup claim', () => {
  it('lists makeupFor, makeupSubject and makeupDeadline on every fact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'school-makeup-claim-'));
    try {
      const store = new YamlWorkSessionDatastore({
        configService: { getHouseholdPath: (suffix) => path.join(root, suffix) },
      });
      await store.appendEvent('ses-plain', {
        type: 'created', at: '2026-11-19T16:00:00.000Z', learnerId: 'kid', unitId: 'math.02', studyDay: '2026-11-19',
      });
      await store.appendEvent('ses-claimed', {
        type: 'created', at: '2026-11-18T16:00:00.000Z', learnerId: 'kid', unitId: 'math.01', studyDay: '2026-11-18',
      });
      await store.appendEvent('ses-claimed', {
        type: 'makeup_claimed', at: '2026-11-19T17:00:00.000Z',
        forDay: '2026-11-18', subject: 'math', deadline: '2026-11-21',
      });
      const facts = await store.listForLearner('kid');
      expect(facts.find((f) => f.sessionId === 'ses-claimed')).toMatchObject({
        makeupFor: '2026-11-18', makeupSubject: 'math', makeupDeadline: '2026-11-21',
      });
      expect(facts.find((f) => f.sessionId === 'ses-plain')).toMatchObject({
        makeupFor: null, makeupSubject: null, makeupDeadline: null,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
