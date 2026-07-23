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
export function __resetRecorder() { head = 0; count = 0; dropped = 0; }
export function __snapshotForTest() {
  const records = [];
  const start = count < CAPACITY ? 0 : head;
  for (let n = 0; n < count; n++) {
    const i = (start + n) % CAPACITY;
    records.push({ t: t[i], kind: kind[i], a: a[i], b: b[i], c: c[i], d: d[i] });
  }
  return { count, dropped, records };
}
