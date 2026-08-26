import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { ReprintIssuedArtifact } from './ReprintIssuedArtifact.mjs';

describe('ReprintIssuedArtifact', () => {
  it('prints the immutable retained bytes with the same card mapping and no new allocation', async () => {
    const bytes = Buffer.from('%PDF-1.7\nimmutable worksheet bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const events = [
      { type: 'created', at: '2026-08-23T15:00:00.000Z', sessionId: 'ses_1', seq: 1, learnerId: 'learner3', unitId: 'lesson-1' },
      { type: 'issued', at: '2026-08-23T15:01:00.000Z', sessionId: 'ses_1', seq: 2, artifactId: 'art_1' },
    ];
    const sessions = {
      readEvents: vi.fn(async () => events),
      appendEvent: vi.fn(async (_sessionId, event) => events.push({ ...event, seq: events.length + 1 })),
    };
    const printer = { printPdf: vi.fn(async () => ({ printed: true, confirmed: true })) };
    const useCase = new ReprintIssuedArtifact({
      issuedArtifacts: { get: vi.fn(async () => ({ bytes, manifest: { artifactId: 'art_1', sessionId: 'ses_1', sha256,
        allocation: { cardId: '1234567', rowRange: { start: 21, end: 26 } } } })) },
      sessions, printer, teacherGate: { assert: vi.fn() }, logger: { info() {} },
    });
    const args = { artifactId: 'art_1', reprintedBy: 'parent', pin: '1234', idempotencyKey: 'reprint-1', apply: true };

    const first = await useCase.execute(args);
    expect(first).toMatchObject({ applied: true, cardId: '1234567', rowRange: { start: 21, end: 26 }, sha256 });
    expect(printer.printPdf).toHaveBeenCalledWith(bytes, expect.any(Object));
    expect(createHash('sha256').update(printer.printPdf.mock.calls[0][0]).digest('hex')).toBe(sha256);

    const replay = await useCase.execute(args);
    expect(replay).toMatchObject({ applied: true, idempotent: true, cardId: '1234567', sha256 });
    expect(printer.printPdf).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'reprinted')).toHaveLength(1);
  });
});

/**
 * These run against the REAL `YamlWorkSessionDatastore`, not a fake, because the
 * fact under test is one only the datastore knows: it refuses an illegal
 * transition at write time. A fake that accepts every append cannot tell a fixed
 * reprint guard from a broken one — the broken version would "pass" by silently
 * writing a `reprinted` event onto a handed-in session.
 */
describe('ReprintIssuedArtifact against the real work-session datastore', () => {
  const BYTES = Buffer.from('%PDF-1.7\nimmutable worksheet bytes');
  const SHA = createHash('sha256').update(BYTES).digest('hex');
  const ART = 'art_1';

  const realSessions = () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-reprint-'));
    return new YamlWorkSessionDatastore({
      configService: { getDataDir: () => tmp, getHouseholdPath: (rel) => path.join(tmp, rel) },
      logger: { info() {}, warn() {}, error() {} },
    });
  };

  const seed = async (sessions, sessionId, extra = []) => {
    await sessions.appendEvent(sessionId, { type: 'created', at: '2026-08-23T15:00:00.000Z', sessionId, learnerId: 'learner3', unitId: 'lesson-1' });
    await sessions.appendEvent(sessionId, { type: 'issued', at: '2026-08-23T15:01:00.000Z', sessionId, artifactId: ART });
    for (const event of extra) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId });
    }
    return sessions;
  };

  const build = (sessions, sessionId, printer) => new ReprintIssuedArtifact({
    issuedArtifacts: { get: vi.fn(async () => ({ bytes: BYTES, manifest: { artifactId: ART, sessionId, sha256: SHA,
      allocation: { cardId: '1234567', rowRange: { start: 21, end: 26 } } } })) },
    sessions, printer, teacherGate: { assert: vi.fn() }, logger: { info() {}, warn() {} },
  });

  it('refuses a reprint of work already handed in — and prints no paper doing it', async () => {
    const sessionId = 'ses_submitted';
    const sessions = await seed(realSessions(), sessionId, [
      { type: 'submitted', at: '2026-08-23T16:00:00.000Z', transport: 'paper' },
    ]);
    const printer = { printPdf: vi.fn(async () => ({ printed: true, confirmed: true })) };

    await expect(build(sessions, sessionId, printer).execute({
      artifactId: ART, reprintedBy: 'parent', pin: '1234', idempotencyKey: 'reprint-1', apply: true,
    })).rejects.toMatchObject({ name: 'DomainInvariantError', code: 'SESSION_NOT_REPRINTABLE' });

    expect(printer.printPdf).not.toHaveBeenCalled();
    const after = await sessions.readEvents(sessionId);
    expect(after.filter((event) => event.type === 'reprinted')).toHaveLength(0);
    expect(after).toHaveLength(3);
  });

  it('refuses a reprint of a graded session', async () => {
    const sessionId = 'ses_graded';
    const sessions = await seed(realSessions(), sessionId, [
      { type: 'submitted', at: '2026-08-23T16:00:00.000Z', transport: 'paper' },
      { type: 'graded', at: '2026-08-23T16:05:00.000Z', attemptIds: ['a1'], percent: 90 },
    ]);
    const printer = { printPdf: vi.fn(async () => ({ printed: true, confirmed: true })) };

    await expect(build(sessions, sessionId, printer).execute({
      artifactId: ART, reprintedBy: 'parent', pin: '1234', idempotencyKey: 'reprint-2', apply: true,
    })).rejects.toMatchObject({ name: 'DomainInvariantError', code: 'SESSION_NOT_REPRINTABLE' });
    expect(printer.printPdf).not.toHaveBeenCalled();
  });

  it('still reprints an issued session, and a replayed key does not print twice', async () => {
    const sessionId = 'ses_issued';
    const sessions = await seed(realSessions(), sessionId);
    const printer = { printPdf: vi.fn(async () => ({ printed: true, confirmed: true })) };
    const useCase = build(sessions, sessionId, printer);
    const args = { artifactId: ART, reprintedBy: 'parent', pin: '1234', idempotencyKey: 'reprint-3', apply: true };

    const first = await useCase.execute(args);
    expect(first).toMatchObject({ applied: true, cardId: '1234567', sha256: SHA });
    expect(printer.printPdf).toHaveBeenCalledTimes(1);

    const replay = await useCase.execute(args);
    expect(replay).toMatchObject({ applied: true, idempotent: true, sha256: SHA });
    expect(printer.printPdf).toHaveBeenCalledTimes(1);
    const after = await sessions.readEvents(sessionId);
    expect(after.filter((event) => event.type === 'reprinted')).toHaveLength(1);
  });

  it('reprints again from the reprinted state (a second, distinct reprint)', async () => {
    const sessionId = 'ses_twice';
    const sessions = await seed(realSessions(), sessionId);
    const printer = { printPdf: vi.fn(async () => ({ printed: true, confirmed: true })) };
    const useCase = build(sessions, sessionId, printer);

    await useCase.execute({ artifactId: ART, reprintedBy: 'parent', pin: '1234', idempotencyKey: 'k1', apply: true });
    await useCase.execute({ artifactId: ART, reprintedBy: 'parent', pin: '1234', idempotencyKey: 'k2', apply: true });

    expect(printer.printPdf).toHaveBeenCalledTimes(2);
    const after = await sessions.readEvents(sessionId);
    expect(after.filter((event) => event.type === 'reprinted')).toHaveLength(2);
  });
});
