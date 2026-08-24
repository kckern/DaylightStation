import { describe, it, expect } from 'vitest';
import { IssueDocument } from './IssueDocument.mjs';
import { FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, silentLogger } from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

describe('IssueDocument exact artifact retention', () => {
  it('archives before first print and reprints retained bytes instead of a new render', async () => {
    const sessions = new FakeSessionRepository();
    const records = new Map();
    const issuedArtifacts = {
      get: async (id) => records.get(id) ?? null,
      put: async (value) => {
        expect(printer.jobs).toHaveLength(0);
        const retained = { manifest: { artifactId: value.artifactId }, bytes: Buffer.from(value.bytes) };
        records.set(value.artifactId, retained);
        return retained;
      },
    };
    let renders = 0;
    const renderer = { render: async () => ({ pdf: Buffer.from(`render-${++renders}`), pageCount: 1 }) };
    const printer = { jobs: [], printPdf: async (bytes) => { printer.jobs.push(Buffer.from(bytes)); return { confirmed: false }; } };
    const issue = new IssueDocument({
      curriculum: {
        getUnit: async () => ({ unitId: 'u1', document: 'doc1' }),
        getDocument: async () => ({ id: 'doc1', blocks: [] }),
      }, sessions, tokens: new FakeTokenRegistry(), renderer, printer,
      formMaps: new FakeFormMapStore(), issuedArtifacts,
      clock: () => new Date('2026-08-24T10:00:00.000Z'), newArtifactId: () => 'art_1', logger: silentLogger,
    });
    await sessions.appendEvent('ses_1', { type: 'created', at: '2026-08-24T09:00:00.000Z',
      sessionId: 'ses_1', learnerId: 'kid', unitId: 'u1' });
    await issue.execute({ sessionId: 'ses_1' });
    await issue.execute({ sessionId: 'ses_1' });
    expect(renders).toBe(2); // current source is still validated/rendered
    expect(printer.jobs.map((bytes) => bytes.toString())).toEqual(['render-1', 'render-1']);
  });
});
