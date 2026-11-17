import { it, expect, vi, beforeEach, afterEach } from 'vitest';
const h = vi.hoisted(() => ({ ack: vi.fn() }));
vi.mock('../schoolApi.js', () => ({ schoolApi: { selfServiceMountAck: (...args) => h.ack(...args) } }));
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }); vi.resetModules(); sessionStorage.clear(); h.ack.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });
const entry = receipt => ({ mountReceipt: receipt, mountExpiresAt: new Date(Date.now()+120000).toISOString() });
it('retries a lost ACK with the identical receipt and true result after reload', async () => {
  h.ack.mockResolvedValueOnce({ ok: false, status: 0 }).mockResolvedValue({ ok: true, data: { ok: true, committed: true, replayed: true } });
  let queue = await import('./mountAcknowledgements.js');
  queue.rememberMount(entry('signed-receipt')); await queue.settleMount('signed-receipt', true);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))[0].mounted).toBe(true);
  vi.clearAllTimers(); vi.resetModules();
  queue = await import('./mountAcknowledgements.js'); queue.resumeMountAcknowledgements();
  await queue.flushMountAcknowledgements();
  expect(h.ack.mock.calls.map(([body]) => [body])).toEqual([[{ receipt: 'signed-receipt', mounted: true }], [{ receipt: 'signed-receipt', mounted: true }]]);
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

it('bounds a hung ACK, lets a second receipt progress, aborts attempts and expires the queue', async () => {
  const attempts = []; let finishLate;
  h.ack.mockImplementation((body, options) => {
    if (body.receipt === 'second') return Promise.resolve({ ok: true, data: { ok: true } });
    attempts.push(options?.signal);
    return new Promise(resolve => { finishLate ??= resolve; });
  });
  const queue = await import('./mountAcknowledgements.js');
  queue.rememberMount(entry('first')); void queue.settleMount('first', true);
  queue.rememberMount(entry('second')); void queue.settleMount('second', true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.ack.mock.calls.some(([body]) => body.receipt === 'second')).toBe(true);
  expect(attempts[0]?.aborted).toBe(true);
  finishLate({ ok: true, data: { ok: true } });
  await Promise.resolve();
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1')).map(item => item.receipt)).toEqual(['first']);
  await vi.advanceTimersByTimeAsync(115000);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toEqual([]);
  expect(attempts.every(signal => signal?.aborted)).toBe(true);
});
for (const jump of [3600000, -3600000]) {
  it(`keeps the in-process expiry monotonic during a ${jump} ms wall-clock correction`, async () => {
    h.ack.mockResolvedValue({ ok: false, status: 0 });
    const queue = await import('./mountAcknowledgements.js');
    const prepared = entry('clock-receipt');
    queue.rememberMount(prepared); await queue.settleMount(prepared.mountReceipt, true);
    const wallNow = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(wallNow+jump);
    await vi.advanceTimersByTimeAsync(3000);
    expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toHaveLength(1);
    expect(h.ack.mock.calls.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(117000);
    expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toEqual([]);
  });
}
it('remembering the same receipt again cannot reset its monotonic deadline or known result', async () => {
  h.ack.mockResolvedValue({ ok: false, status: 0 });
  const queue = await import('./mountAcknowledgements.js'); const prepared = entry('duplicate');
  queue.rememberMount(prepared); await queue.settleMount(prepared.mountReceipt, true);
  await vi.advanceTimersByTimeAsync(60000);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now()-3600000);
  queue.rememberMount(prepared);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))[0].mounted).toBe(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(JSON.parse(sessionStorage.getItem('school.mount-ack.v1'))).toEqual([]);
});
