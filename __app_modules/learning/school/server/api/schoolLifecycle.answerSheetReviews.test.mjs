import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createSchoolLifecycleRouter } from "./schoolLifecycle.mjs";

function app(reviewHeldCardScan) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
    reviewHeldCardScan,
    logger: { info() {}, warn() {} },
  }));
  return server;
}

describe('school lifecycle answer-sheet review routes', () => {
  it('passes the reviewer to the gated queue read', async () => {
    const reviewHeldCardScan = {
      list: vi.fn(async () => [{ heldScanId: 'held-1' }]),
    };

    await request(app(reviewHeldCardScan))
      .get('/api/v1/school/lifecycle/answer-sheet-reviews?reviewerId=parent')
      .expect(200)
      .expect({ items: [{ heldScanId: 'held-1' }] });

    expect(reviewHeldCardScan.list).toHaveBeenCalledWith({
      reviewerId: 'parent',
    });
  });

  it('passes the reviewer to a grouped recovery mutation', async () => {
    const reviewHeldCardScan = {
      resolve: vi.fn(async () => ({ review: { action: 'redo' }, duplicate: false })),
    };

    await request(app(reviewHeldCardScan))
      .post('/api/v1/school/lifecycle/answer-sheet-reviews/held-1/resolve')
      .send({ action: 'redo', reviewerId: 'parent', idempotencyKey: 'once-1' })
      .expect(200);

    expect(reviewHeldCardScan.resolve).toHaveBeenCalledWith({
      heldScanId: 'held-1',
      action: 'redo',
      targetRecordId: null,
      reviewerId: 'parent',
      idempotencyKey: 'once-1',
    });
  });

  it('passes the reviewer to the gated inspection', async () => {
    const reviewHeldCardScan = {
      inspect: vi.fn(async () => ({ heldScanId: 'held-1', evidence: {} })),
    };

    await request(app(reviewHeldCardScan))
      .get('/api/v1/school/lifecycle/answer-sheet-reviews/held-1?reviewerId=parent')
      .expect(200)
      .expect({ heldScanId: 'held-1', evidence: {} });

    expect(reviewHeldCardScan.inspect).toHaveBeenCalledWith({
      heldScanId: 'held-1',
      reviewerId: 'parent',
    });
  });

  it('passes the reviewer and the explicit method to quarantine clearance', async () => {
    const reviewHeldCardScan = {
      clearQuarantine: vi.fn(async () => ({ method: 'verified-erased', reviewerId: 'parent' })),
    };

    await request(app(reviewHeldCardScan))
      .post('/api/v1/school/lifecycle/answer-sheets/8684155/quarantines/held%3A1-3/clear')
      .send({ method: 'verified-erased', reviewerId: 'parent' })
      .expect(200);

    expect(reviewHeldCardScan.clearQuarantine).toHaveBeenCalledWith({
      cardId: '8684155',
      quarantineId: 'held:1-3',
      method: 'verified-erased',
      reviewerId: 'parent',
    });
  });
});
