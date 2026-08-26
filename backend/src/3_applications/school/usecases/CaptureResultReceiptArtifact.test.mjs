import { describe, expect, it, vi } from 'vitest';
import { CaptureResultReceiptArtifact } from './CaptureResultReceiptArtifact.mjs';

describe('CaptureResultReceiptArtifact', () => {
  it('persists a frozen receipt document with the original PNG and is idempotent', async () => {
    const saved = { manifest: { artifactId: 'receipt/ses_1/out:ses_1' }, bytes: Buffer.from('png') };
    const artifacts = { get: vi.fn(async () => null), put: vi.fn(async () => saved) };
    const capture = new CaptureResultReceiptArtifact({ artifacts, issuedArtifacts: artifacts,
      renderReceipt: vi.fn(async (document) => ({ bytes: Buffer.from('png'), width: 384, height: 200 })) });
    const document = { schema: 'school.document-source/v1', id: 'result-ses-1', target: ['receipt'], blocks: [] };
    const result = await capture.execute({ artifactId: 'receipt/ses_1/out:ses_1', sessionId: 'ses_1',
      learnerId: 'learner3', unitId: 'illinois', issuedAt: '2026-08-24T10:00:00.000Z', document });
    expect(result.created).toBe(true);
    expect(artifacts.put).toHaveBeenCalledWith(expect.objectContaining({ kind: 'result-receipt', sourceDocument: document,
      representation: expect.objectContaining({ mediaType: 'image/png', width: 384 }) }));
  });
});
