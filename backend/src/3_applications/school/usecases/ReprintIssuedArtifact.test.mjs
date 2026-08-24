import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { ReprintIssuedArtifact } from './ReprintIssuedArtifact.mjs';

describe('ReprintIssuedArtifact', () => {
  it('prints the immutable retained bytes with the same card mapping and no new allocation', async () => {
    const bytes = Buffer.from('%PDF-1.7\nimmutable worksheet bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const events = [
      { type: 'created', at: '2026-08-23T15:00:00.000Z', sessionId: 'ses_1', seq: 1, learnerId: 'milo', unitId: 'lesson-1' },
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
