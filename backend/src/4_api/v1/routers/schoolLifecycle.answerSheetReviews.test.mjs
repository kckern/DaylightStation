import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createSchoolLifecycleRouter } from './schoolLifecycle.mjs';

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
  it('teacher-gates the queue read with the HttpOnly capability cookie', async () => {
    const reviewHeldCardScan = {
      list: vi.fn(async () => [{ heldScanId: 'held-1' }]),
    };

    await request(app(reviewHeldCardScan))
      .get('/api/v1/school/lifecycle/answer-sheet-reviews?reviewerId=parent')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .expect(200)
      .expect({ items: [{ heldScanId: 'held-1' }] });

    expect(reviewHeldCardScan.list).toHaveBeenCalledWith({
      reviewerId: 'parent',
      pin: { capabilityToken: 'session-1', stepUpToken: null },
    });
  });

  it('passes capability and step-up proof to a grouped recovery mutation', async () => {
    const reviewHeldCardScan = {
      resolve: vi.fn(async () => ({ review: { action: 'redo' }, duplicate: false })),
    };

    await request(app(reviewHeldCardScan))
      .post('/api/v1/school/lifecycle/answer-sheet-reviews/held-1/resolve')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .set('X-Teacher-Step-Up', 'grant-1')
      .send({ action: 'redo', reviewerId: 'parent', idempotencyKey: 'once-1' })
      .expect(200);

    expect(reviewHeldCardScan.resolve).toHaveBeenCalledWith({
      heldScanId: 'held-1',
      action: 'redo',
      targetRecordId: null,
      reviewerId: 'parent',
      pin: { capabilityToken: 'session-1', stepUpToken: 'grant-1' },
      idempotencyKey: 'once-1',
    });
  });

  it('teacher-gates inspection without putting a PIN in the URL', async () => {
    const reviewHeldCardScan = {
      inspect: vi.fn(async () => ({ heldScanId: 'held-1', evidence: {} })),
    };

    await request(app(reviewHeldCardScan))
      .get('/api/v1/school/lifecycle/answer-sheet-reviews/held-1?reviewerId=parent')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .expect(200)
      .expect({ heldScanId: 'held-1', evidence: {} });

    expect(reviewHeldCardScan.inspect).toHaveBeenCalledWith({
      heldScanId: 'held-1',
      reviewerId: 'parent',
      pin: { capabilityToken: 'session-1', stepUpToken: null },
    });
  });

  it('passes teacher proof and the explicit method to quarantine clearance', async () => {
    const reviewHeldCardScan = {
      clearQuarantine: vi.fn(async () => ({ method: 'verified-erased', reviewerId: 'parent' })),
    };

    await request(app(reviewHeldCardScan))
      .post('/api/v1/school/lifecycle/answer-sheets/8684155/quarantines/held%3A1-3/clear')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .set('X-Teacher-Step-Up', 'grant-1')
      .send({ method: 'verified-erased', reviewerId: 'parent' })
      .expect(200);

    expect(reviewHeldCardScan.clearQuarantine).toHaveBeenCalledWith({
      cardId: '8684155',
      quarantineId: 'held:1-3',
      method: 'verified-erased',
      reviewerId: 'parent',
      pin: { capabilityToken: 'session-1', stepUpToken: 'grant-1' },
    });
  });
});
