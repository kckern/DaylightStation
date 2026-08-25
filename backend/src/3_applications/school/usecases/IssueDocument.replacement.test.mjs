/**
 * 2026-08-25 incident: a learner scanned, was told his sheet was already
 * issued, tried again, and was told the worksheet does not exist. Both
 * messages were true — `IssueDocument`'s `#reprintExact` treated "this
 * session issued something once" (`state.issuedArtifacts.length > 0`) as a
 * synonym for "a reprintable copy exists", and refused outright the moment
 * retention had no bytes. See
 * docs/_wip/bugs/2026-08-25-unprintable-session-already-issued-but-gone.md.
 *
 * These tests pin two things at once: the dead end is gone (a replacement
 * prints), AND the healthy exact-reprint path — the one every other scan in
 * the house depends on — is untouched by the change.
 */
import { describe, it, expect } from 'vitest';
import { IssueDocument } from './IssueDocument.mjs';
import { FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, silentLogger } from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

/** Captures warn/info calls without printing anything, so a test can assert on them. */
function spyLogger() {
  const calls = { warn: [], info: [] };
  return {
    warn: (event, data) => calls.warn.push({ event, data }),
    info: (event, data) => calls.info.push({ event, data }),
    error: () => {},
    debug: () => {},
    calls,
  };
}

async function seedIssuedSession(sessions, {
  sessionId = 'ses_GxBZiBqG', unitId = 'u1', artifactId, at = '2026-08-23T18:59:58.790Z',
} = {}) {
  await sessions.appendEvent(sessionId, {
    type: 'created', at, sessionId, learnerId: 'kid', unitId,
  });
  await sessions.appendEvent(sessionId, {
    type: 'issued', at, sessionId, artifactId, confirmed: true,
  });
}

describe('IssueDocument — a missing artifact issues a replacement, not a dead end', () => {
  it('issues a replacement when the original artifact is gone, instead of dead-ending', async () => {
    // The 2026-08-23 state, verbatim from the incident: the `issued` event
    // names a real artifact; the retention store has never heard of it.
    const artifactId = 'civilization/young-peoples-atlas-us/ws-ses-gxbzibqg';
    const sessions = new FakeSessionRepository();
    await seedIssuedSession(sessions, { artifactId });

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
    const logger = spyLogger();

    const issueDocument = new IssueDocument({
      curriculum: {
        getUnit: async () => ({ unitId: 'u1', document: 'doc1' }),
        getDocument: async () => ({ id: 'doc1', blocks: [] }),
      },
      sessions,
      tokens: new FakeTokenRegistry(),
      renderer: { render: async () => ({ pdf: Buffer.from('regenerated'), pageCount: 1 }) },
      printer,
      formMaps: new FakeFormMapStore(),
      issuedArtifacts,
      clock: () => new Date('2026-08-25T12:01:48.000Z'),
      logger,
    });

    const result = await issueDocument.execute({ sessionId: 'ses_GxBZiBqG' });

    // The load-bearing assertion: NOT the dead end.
    expect(result.status).not.toBe('unavailable');
    expect(printer.jobs).toHaveLength(1);
    expect(result.message).not.toMatch(/could not print/i);

    // Honest about what happened: the retained copy is filed as a
    // replacement, never silently as if it had always been the original.
    expect(retained.get(artifactId).manifest.captureKind).toBe('replacement');

    // The audit trail a teacher may need to reconcile a gradebook.
    const warned = logger.calls.warn.find((c) => c.event === 'school.issue.replacement-issued');
    expect(warned).toBeTruthy();
    expect(warned.data).toMatchObject({ sessionId: 'ses_GxBZiBqG', unitId: 'u1', missingArtifactId: artifactId });

    // The session's own event log stays legally consistent: reducing it again
    // must not accumulate an illegal-transition error. This is what rules out
    // the naive fix of appending a fresh `issued` event on top of an
    // already-`issued` session — `sessionEvents.mjs`'s TRANSITIONS table does
    // not allow that, and reduceSession would silently drop it and record an
    // error instead.
    const replayed = sessions.derive('ses_GxBZiBqG');
    expect(replayed.errors).toEqual([]);
    expect(replayed.issuedArtifacts).toContain(artifactId);
  });

  it('leaves the healthy reprint path untouched: retained bytes still take exact-reprint, no replacement', async () => {
    const artifactId = 'art_retained';
    const sessions = new FakeSessionRepository();
    await seedIssuedSession(sessions, { artifactId });

    const retainedBytes = Buffer.from('exact-original-bytes');
    const issuedArtifacts = {
      get: async (id) => (id === artifactId ? { manifest: { artifactId, captureKind: 'original', pageCount: 3 }, bytes: retainedBytes } : null),
      put: async () => { throw new Error('a healthy exact reprint must never write a new retained artifact'); },
    };
    let renders = 0;
    const printer = { jobs: [], printPdf: async (bytes) => { printer.jobs.push(Buffer.from(bytes)); return { confirmed: true }; } };
    const logger = spyLogger();

    const issueDocument = new IssueDocument({
      curriculum: {
        getUnit: async () => ({ unitId: 'u1', document: 'doc1' }),
        getDocument: async () => ({ id: 'doc1', blocks: [] }),
      },
      sessions,
      tokens: new FakeTokenRegistry(),
      renderer: { render: async () => { renders += 1; return { pdf: Buffer.from('should-never-render'), pageCount: 1 }; } },
      printer,
      formMaps: new FakeFormMapStore(),
      issuedArtifacts,
      clock: () => new Date('2026-08-25T12:01:48.000Z'),
      logger,
    });

    const result = await issueDocument.execute({ sessionId: 'ses_GxBZiBqG' });

    expect(result.status).toBe('reprinted');
    expect(result.artifactId).toBe(artifactId);
    expect(renders).toBe(0); // never re-rendered — the retained bytes ARE the sheet
    expect(printer.jobs).toHaveLength(1);
    expect(printer.jobs[0].toString()).toBe('exact-original-bytes');

    // No replacement machinery engaged at all.
    expect(logger.calls.warn.find((c) => c.event === 'school.issue.replacement-issued')).toBeFalsy();
    expect(logger.calls.warn.find((c) => c.event === 'school.issue.exact-artifact-unavailable')).toBeFalsy();

    const replayed = sessions.derive('ses_GxBZiBqG');
    expect(replayed.errors).toEqual([]);
  });
});
