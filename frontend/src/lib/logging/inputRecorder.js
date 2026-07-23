export const CAPACITY = 16384;
const t = new Float64Array(CAPACITY);
const kind = new Uint8Array(CAPACITY);
const a = new Int32Array(CAPACITY);
const b = new Int32Array(CAPACITY);
const c = new Int32Array(CAPACITY);
const d = new Int32Array(CAPACITY);
let head = 0; let count = 0; let dropped = 0;
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
export function record(k, s0 = 0, s1 = 0, s2 = 0, s3 = 0) {
  const i = head;
  t[i] = now();
  kind[i] = k;
  a[i] = s0 | 0; b[i] = s1 | 0; c[i] = s2 | 0; d[i] = s3 | 0;
  head = (head + 1) % CAPACITY;
  if (count < CAPACITY) count += 1;
  else dropped += 1;
}
const internMap = new Map();
const internList = [];
export function intern(str) {
  let id = internMap.get(str);
  if (id === undefined) { id = internList.length; internList.push(str); internMap.set(str, id); }
  return id;
}
export function __internTableForTest() { return internList.slice(); }
export const KIND = Object.freeze({
  MIDI_ON: 1, MIDI_OFF: 2, SUSTAIN: 3, CC: 4,
  TAP: 5, TOUCH_START: 6, TOUCH_MOVE: 7, TOUCH_END: 8,
  UI_INTENT: 9, RENDER: 10, KEY: 11, EDIT: 12,
});
const KIND_NAME = {
  1: 'midi.on', 2: 'midi.off', 3: 'sustain', 4: 'cc',
  5: 'tap', 6: 'touch.start', 7: 'touch.move', 8: 'touch.end',
  9: 'ui.intent', 10: 'render', 11: 'key', 12: 'edit',
};
export function encodeBatch() {
  const out = [];
  const start = count < CAPACITY ? 0 : head;
  for (let n = 0; n < count; n++) {
    const i = (start + n) % CAPACITY;
    out.push([t[i], kind[i], a[i], b[i], c[i], d[i]]);
  }
  const drained = { b: out, dropped, strings: internList.slice() };
  head = 0; count = 0; dropped = 0;
  return drained;
}
export function buildHeader({ session, score, ctx }) {
  const t0 = {
    perf: (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
    wall: Date.now(),
  };
  return { h: 1, session, score, ctx: { ...(ctx || {}), t0 }, kinds: { ...KIND_NAME }, strings: internList.slice() };
}
let drainTimer = null;
let sendFn = null;
export function startRecorder({ session, score, ctx = {}, send, flushMs = 1000 }) {
  // Clear any prior interval first: start can be called twice (config lifecycle +
  // window.__INPUT_REC__.start), and a leaked interval would keep ticking after the
  // next stop and throw every second (sendFn nulled) → kiosk watchdog trips.
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  __resetRecorder();
  sendFn = send;
  sendFn(buildHeader({ session, score, ctx }));
  // Guard: the drain is deferred via requestIdleCallback and can fire up to ~1s
  // after stopRecorder() nulled sendFn (recording is always-on and keeps feeding
  // the ring), so a bare sendFn(batch) would throw. Skip when stopped.
  const tick = () => { if (!sendFn) return; const batch = encodeBatch(); if (batch.b.length > 0) sendFn(batch); };
  const scheduled = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(tick, { timeout: flushMs });
    else tick();
  };
  drainTimer = setInterval(scheduled, flushMs);
  if (drainTimer && typeof drainTimer.unref === 'function') drainTimer.unref();
}
export function stopRecorder() {
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  if (sendFn) { const batch = encodeBatch(); if (batch.b.length > 0) sendFn(batch); }
  sendFn = null;
}
export function __resetRecorder() { head = 0; count = 0; dropped = 0; internMap.clear(); internList.length = 0; }
export function __snapshotForTest() {
  const records = [];
  const start = count < CAPACITY ? 0 : head;
  for (let n = 0; n < count; n++) {
    const i = (start + n) % CAPACITY;
    records.push({ t: t[i], kind: kind[i], a: a[i], b: b[i], c: c[i], d: d[i] });
  }
  return { count, dropped, records };
}
