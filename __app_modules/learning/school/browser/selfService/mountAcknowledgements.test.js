import { it, expect, vi, beforeEach, afterEach } from 'vitest';
const h = vi.hoisted(() => ({ ack: vi.fn() }));
vi.mock('../schoolApi.js', () => ({ schoolApi: { selfServiceMountAck: (...args) => h.ack(...args) } }));
beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); sessionStorage.clear(); h.ack.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const entry = receipt => ({ mountReceipt: receipt, mountExpiresAt: new Date(Date.now()+120000).toISOString() });
it('retries a lost ACK with the identical receipt and true result after reload', async () => {
  h.ack.mockResolvedValueOnce({ ok: false, status: 0 }).mockResolvedValue({ ok: true, data: { ok: true, committed: true, replayed: true } });
  let queue = await import('./mountAcknowledgements.js');
  queue.rememberMount(entry('signed-receipt')); await queue.settleMount('signed-receipt', true);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))[0].mounted).toBe(true);
  vi.clearAllTimers(); vi.resetModules();
  queue = await import('./mountAcknowledgements.js'); queue.resumeMountAcknowledgements();
  await queue.flushMountAcknowledgements();
  expect(h.ack.mock.calls).toEqual([[{ receipt: 'signed-receipt', mounted: true }], [{ receipt: 'signed-receipt', mounted: true }]]);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toEqual([]);
});
it('releases an uncertain prepared mount after reload and bounds pending storage until expiry', async () => {
  h.ack.mockResolvedValue({ ok: false, status: 0 });
  let queue = await import('./mountAcknowledgements.js');
  for (let i=0;i<12;i++) queue.rememberMount(entry(`receipt-${i}`));
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toHaveLength(8);
  vi.clearAllTimers(); vi.resetModules(); queue = await import('./mountAcknowledgements.js');
  queue.resumeMountAcknowledgements(); await queue.flushMountAcknowledgements();
  expect(h.ack.mock.calls.every(([body]) => body.mounted === false)).toBe(true);
  expect(h.ack).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(120000);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toEqual([]);
});
