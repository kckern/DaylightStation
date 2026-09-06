import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const appFor = publisher => {
  const app = express();
  app.use(createHealthRouter({ healthOperations: { defaultUsername: () => 'owner' },
    receiptPublisherProvider: () => publisher, logger: { info() {}, warn() {}, error() {} } }));
  return app;
};
describe('selective receipt reconciliation HTTP contract', () => {
  it('passes preview options to the publisher using server-owned identity', async () => {
    const publisher = { reconcile: vi.fn(async () => ({ receipts: [{ logId: 'one', delivery: 'preview' }] })) };
    const result = await request(appFor(publisher)).post('/nutrition/receipts/reconcile').send({ userId: 'impostor', logIds: ['one'] });
    expect(result.status).toBe(200);
    expect(publisher.reconcile).toHaveBeenCalledWith('owner', { logIds: ['one'], dryRun: undefined, expectedFingerprints: undefined });
    expect(result.body.receipts[0].delivery).toBe('preview');
  });
  it('fails clearly when unavailable or when preview is stale', async () => {
    expect((await request(appFor(null)).post('/nutrition/receipts/reconcile').send({ logIds: ['one'] })).status).toBe(503);
    const publisher = { reconcile: () => { throw Object.assign(new Error('Preview again'), { status: 409 }); } };
    const result = await request(appFor(publisher)).post('/nutrition/receipts/reconcile').send({ logIds: ['one'], dryRun: false });
    expect(result.status).toBe(409); expect(result.body.error).toBe('Preview again');
  });
});
