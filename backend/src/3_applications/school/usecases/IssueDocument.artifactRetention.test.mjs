import { describe, it, expect } from 'vitest';
import { IssueDocument } from './IssueDocument.mjs';
import { FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, silentLogger } from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

function renderedPdf(content, pageCount = 1) {
  const bytes = Buffer.from(content);
  const artifact = (payload) => ({
    printWith: (printer, options) => printer.printPdf(payload, options),
    retainWith: async (store, metadata) => {
      if (!store) return artifact(payload);
      const retained = await store.put({ ...metadata, bytes: payload });
      return artifact(retained.bytes);
    },
  });
  return { artifact: artifact(bytes), pageCount };
}

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
    const renderer = { render: async () => renderedPdf(`render-${++renders}`) };
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

  it('issues a labelled replacement — never a silent substitute — when an older original was not retained', async () => {
    // 2026-08-25 incident: a session's `issued` event named an artifact that
    // was never captured (retention predates the session). The old behaviour
    // returned `status: 'unavailable'` and left the child unable to print at
    // all — "already issued" and "doesn't exist" were both true with no third
    // option. See docs/_wip/bugs/2026-08-25-unprintable-session-already-issued-but-gone.md.
    const sessions = new FakeSessionRepository();
    const retained = new Map();
    const issuedArtifacts = {
      get: async (id) => retained.get(id) ?? null,
      put: async (value) => {
        const record = { manifest: { artifactId: value.artifactId, captureKind: value.captureKind }, bytes: Buffer.from(value.bytes) };
        retained.set(value.artifactId, record);
        return record;
      },
    };
    const printer = { jobs: [], printPdf: async (bytes) => { printer.jobs.push(Buffer.from(bytes)); return { confirmed: true }; } };
    let now = new Date('2026-08-24T10:00:00.000Z');
    const issue = new IssueDocument({
      curriculum: { getUnit: async () => ({ unitId: 'u1', document: 'doc1' }), getDocument: async () => ({ id: 'doc1', blocks: [] }) },
      sessions, tokens: new FakeTokenRegistry(), renderer: { render: async () => renderedPdf('new-render') },
      printer, formMaps: new FakeFormMapStore(), issuedArtifacts,
      clock: () => now, logger: silentLogger,
    });
    await sessions.appendEvent('ses_legacy', { type: 'created', at: '2026-08-24T09:00:00.000Z', sessionId: 'ses_legacy', learnerId: 'kid', unitId: 'u1' });
    await sessions.appendEvent('ses_legacy', { type: 'issued', at: '2026-08-24T09:01:00.000Z', sessionId: 'ses_legacy', artifactId: 'old-artifact', confirmed: false });

    const result = await issue.execute({ sessionId: 'ses_legacy' });
    // Not the dead end: a sheet is printed instead of `status: 'unavailable'`.
    expect(result.status).not.toBe('unavailable');
    expect(printer.jobs).toHaveLength(1);
    // The integrity rule survives: the replacement is filed under the SAME
    // artifactId the session already knew about (the only choice the event
    // log's own transition rules allow — `reprinted` is the sole event legal
    // once a session has already issued, and it requires a KNOWN artifactId),
    // but retained honestly as a `'replacement'`, never silently as if it had
    // been the original all along.
    expect(result.artifactId).toBe('old-artifact');
    expect(retained.get('old-artifact').manifest.captureKind).toBe('replacement');
    // A subsequent print of the SAME session (past the print-debounce
    // window) now finds retained bytes and takes the plain exact-reprint
    // path — the gap is healed going forward.
    now = new Date('2026-08-24T10:15:00.000Z');
    const second = await issue.execute({ sessionId: 'ses_legacy' });
    expect(second.status).not.toBe('unavailable');
    expect(printer.jobs).toHaveLength(2);
    expect(printer.jobs[1].toString()).toBe('new-render');
  });
});
