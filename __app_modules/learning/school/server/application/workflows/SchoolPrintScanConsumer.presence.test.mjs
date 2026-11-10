/** An OMR sheet fed at a reader reports presence once, graded or not. */
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from './SchoolPrintScanConsumer.mjs';

const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function harness({ presenceHook, resolve = async () => ({ results: [] }) } = {}) {
  let handler = null;
  const graded = [];
  createSchoolPrintScanConsumer({
    realtime: { onPrintSheet: (_c, cb) => { handler = cb; return () => {}; }, printScanResolved() {} },
    resolveCardScan: { execute: resolve },
    gradingHook: { fire: (o) => { graded.push(o); } },
    presenceHook,
    logger: { info() {}, debug() {}, error() {}, warn() {} },
  });
  return { graded, feed: async (payload) => { handler(payload); await settle(); } };
}

describe('SchoolPrintScanConsumer — presence hook', () => {
  it('fires once per sheet with source omr and the reader', async () => {
    const fire = vi.fn();
    const { feed } = harness({ presenceHook: { fire } });
    await feed({ testId: '1234567', answers: {}, device: 'omr-study' });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ source: 'omr', device: 'omr-study' }));
  });

  it('fires for an unreadable sheet too', async () => {
    const fire = vi.fn();
    const { feed } = harness({ presenceHook: { fire } });
    await feed({ testId: null, answers: {}, device: 'omr-study', error: { code: 'OMR_COLUMN_COUNT' } });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('a hung or throwing presence hook does not block the sheet', async () => {
    for (const fire of [() => new Promise(() => {}), () => { throw new Error('x'); }]) {
      const { feed } = harness({ presenceHook: { fire } });
      await feed({ testId: '1234567', answers: {}, device: 'omr-study' });
    }
  });

  it('no presenceHook behaves as before', async () => {
    const { feed, graded } = harness();
    await feed({ testId: '1234567', answers: {} });
    expect(graded).toEqual([]);
  });
});
