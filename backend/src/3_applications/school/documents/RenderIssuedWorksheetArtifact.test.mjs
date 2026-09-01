import { describe, expect, it, vi } from 'vitest';
import { RenderIssuedWorksheetArtifact } from './RenderIssuedWorksheetArtifact.mjs';

describe('RenderIssuedWorksheetArtifact', () => {
  it('regenerates from YAML with the recorded card mapping and no allocation command', async () => {
    const sourceDocument = { schema: 'school.document/v2', id: 'math/place-value', rev: 'r1', blocks: [] };
    const artifact = {
      manifest: {
        artifactId: 'math/place-value/ws-1', kind: 'worksheet', captureKind: 'original',
        issuedAt: '2026-08-31T18:00:00.000Z', learnerId: 'user_4', sourceDocument,
        allocation: { cardId: '8424408', rowRange: { start: 28, end: 32 } },
        renderContext: {
          automaticCard: true, answerSheetPolicy: { reuse: 'until_full' },
          learnerId: 'user_4', learnerName: 'User_4', date: '31 Aug 2026', cardFirstUse: false,
        },
      },
      bytes: null,
    };
    const renderPrintDocument = { execute: vi.fn(async () => ({
      bytes: Buffer.from('%PDF current engine'), pageCount: 1, duplex: false,
    })) };
    const useCase = new RenderIssuedWorksheetArtifact({
      issuedArtifacts: { get: vi.fn(async () => artifact) }, renderPrintDocument,
    });

    const result = await useCase.execute({ artifactId: artifact.manifest.artifactId });

    expect(result).toMatchObject({ generated: true, pageCount: 1, duplex: false });
    expect(renderPrintDocument.execute).toHaveBeenCalledWith({
      document: sourceDocument,
      context: {
        learnerId: 'user_4', learnerName: 'User_4', date: '31 Aug 2026',
        cardId: '8424408', startRow: 28, historicalCard: true, historicalFirstUse: false,
      },
    });
  });

  it('uses retained bytes only for a legacy manifest whose source cannot be resolved', async () => {
    const bytes = Buffer.from('%PDF legacy');
    const artifact = { manifest: { artifactId: 'old', kind: 'worksheet', sha256: 'old-sha' }, bytes };
    const renderPrintDocument = { execute: vi.fn() };
    const useCase = new RenderIssuedWorksheetArtifact({
      issuedArtifacts: { get: vi.fn(async () => artifact) }, renderPrintDocument,
    });

    await expect(useCase.execute({ artifactId: 'old' })).resolves.toMatchObject({
      bytes, generated: false, sha256: 'old-sha',
    });
    expect(renderPrintDocument.execute).not.toHaveBeenCalled();
  });
});
