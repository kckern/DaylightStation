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
    expect(renders).toBe(1); // reprint never re-renders mutable source data
    expect(printer.jobs.map((bytes) => bytes.toString())).toEqual(['render-1', 'render-1']);
  });

  it('refuses to substitute a current rendering when an older original was not retained', async () => {
    const sessions = new FakeSessionRepository();
    const printer = { jobs: [], printPdf: async (bytes) => { printer.jobs.push(Buffer.from(bytes)); return { confirmed: true }; } };
    const issue = new IssueDocument({
      curriculum: { getUnit: async () => ({ unitId: 'u1', document: 'doc1' }), getDocument: async () => ({ id: 'doc1', blocks: [] }) },
      sessions, tokens: new FakeTokenRegistry(), renderer: { render: async () => ({ pdf: Buffer.from('new-render'), pageCount: 1 }) },
      printer, formMaps: new FakeFormMapStore(), issuedArtifacts: { get: async () => null, put: async () => { throw new Error('must not archive a substitute'); } },
      clock: () => new Date('2026-08-24T10:00:00.000Z'), logger: silentLogger,
    });
    await sessions.appendEvent('ses_legacy', { type: 'created', at: '2026-08-24T09:00:00.000Z', sessionId: 'ses_legacy', learnerId: 'kid', unitId: 'u1' });
    await sessions.appendEvent('ses_legacy', { type: 'issued', at: '2026-08-24T09:01:00.000Z', sessionId: 'ses_legacy', artifactId: 'old-artifact', confirmed: false });

    const result = await issue.execute({ sessionId: 'ses_legacy' });
    expect(result.status).toBe('unavailable');
    expect(result.message).toMatch(/original worksheet was not retained/i);
    expect(printer.jobs).toHaveLength(0);
  });
});
