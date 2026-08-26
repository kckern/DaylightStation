import { describe, expect, it, vi } from 'vitest';
import { ReprintResultReceiptArtifact } from './ReprintResultReceiptArtifact.mjs';

const sessionId = 'ses_1';
const artifactId = 'receipt/ses_1/out:ses_1';
const events = [
  { type: 'created', at: '2026-08-24T10:00:00.000Z', sessionId, seq: 1, learnerId: 'learner3', unitId: 'illinois' },
  { type: 'issued', at: '2026-08-24T10:01:00.000Z', sessionId, seq: 2, artifactId: 'worksheet/ses_1' },
  { type: 'submitted', at: '2026-08-24T10:02:00.000Z', sessionId, seq: 3, transport: 'paper' },
  { type: 'graded', at: '2026-08-24T10:03:00.000Z', sessionId, seq: 4, attemptIds: ['att_1'], percent: 100 },
  { type: 'outcome_recorded', at: '2026-08-24T10:04:00.000Z', sessionId, seq: 5, outcomeId: 'out:ses_1', result: 'passed' },
  { type: 'result_receipt_captured', at: '2026-08-24T10:04:00.000Z', sessionId, seq: 6,
    artifactId, kind: 'result-receipt', printed: true },
];

describe('ReprintResultReceiptArtifact', () => {
  it('prints retained PNG bytes and appends an annotation without minting a new artifact', async () => {
    const printer = { print: vi.fn(async () => true) };
    const sessions = { readEvents: vi.fn(async () => events), appendEvent: vi.fn(async () => {}) };
    const useCase = new ReprintResultReceiptArtifact({
      issuedArtifacts: { get: vi.fn(async () => ({ bytes: Buffer.from('png'), manifest: {
        artifactId, sessionId, kind: 'result-receipt', sha256: 'digest',
        representation: { mediaType: 'image/png', extension: 'png', width: 384, height: 200 },
      } })) },
      sessions, teacherGate: { assert: vi.fn() }, receiptArtifactPrinter: printer,
      clock: () => new Date('2026-08-24T11:00:00.000Z'),
    });
    await expect(useCase.execute({ artifactId, reprintedBy: 'parent', pin: '1234', idempotencyKey: 'r1', apply: true }))
      .resolves.toMatchObject({ applied: true, artifactId });
    expect(printer.print).toHaveBeenCalledWith(expect.objectContaining({ bytes: Buffer.from('png') }));
    expect(sessions.appendEvent).toHaveBeenCalledWith(sessionId, expect.objectContaining({ type: 'result_receipt_reprinted', artifactId }));
  });
});
