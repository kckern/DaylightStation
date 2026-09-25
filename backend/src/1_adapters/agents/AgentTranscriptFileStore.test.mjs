// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentTranscriptFileStore } from './AgentTranscriptFileStore.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const tmp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcripts-')); roots.push(root); return root; };

describe('AgentTranscriptFileStore.find', () => {
  it('finds a turn by its id in the run day, or the next day for a run that crossed midnight', async () => {
    const store = new AgentTranscriptFileStore({ mediaDir: tmp() });
    await store.save({ agentId: 'nutrition-auditor', userId: 'alice', turnId: 'turn1234abcd', startedAt: new Date('2026-09-04T18:00:05.123Z'),
      transcript: { turnId: 'turn1234abcd', toolCalls: [] } });
    await store.save({ agentId: 'nutrition-auditor', userId: 'alice', turnId: 'late5678wxyz', startedAt: new Date('2026-09-05T00:00:40.000Z'),
      transcript: { turnId: 'late5678wxyz', toolCalls: [{ name: 'read_capture' }] } });
    expect(await store.find({ agentId: 'nutrition-auditor', userId: 'alice', startedAt: '2026-09-04T18:00:00.000Z', turnId: 'turn1234abcd' }))
      .toEqual({ turnId: 'turn1234abcd', toolCalls: [] });
    expect((await store.find({ agentId: 'nutrition-auditor', userId: 'alice', startedAt: '2026-09-04T23:59:50.000Z', turnId: 'late5678wxyz' })).toolCalls)
      .toEqual([{ name: 'read_capture' }]);
  });
  it('answers null for a missing, expired or unsafe lookup', async () => {
    const store = new AgentTranscriptFileStore({ mediaDir: tmp() });
    expect(await store.find({ agentId: 'nutrition-auditor', userId: 'alice', startedAt: '2026-09-04T18:00:00.000Z', turnId: 'nothere1' })).toBeNull();
    expect(await store.find({ agentId: '../etc', userId: 'alice', startedAt: '2026-09-04T18:00:00.000Z', turnId: 'turn1234' })).toBeNull();
    expect(await store.find({ agentId: 'nutrition-auditor', userId: 'alice', startedAt: 'not a date', turnId: 'turn1234' })).toBeNull();
    expect(await store.find({ agentId: 'nutrition-auditor', userId: 'alice', startedAt: '2026-09-04T18:00:00.000Z', turnId: '' })).toBeNull();
    expect(await store.find({ agentId: 'nutrition-auditor', userId: 'alice', startedAt: '2026-09-04T18:00:00.000Z', turnId: ['turn1234'] })).toBeNull();
  });
});
