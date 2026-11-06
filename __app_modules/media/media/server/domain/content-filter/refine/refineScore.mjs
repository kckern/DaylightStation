/**
 * Score refine results against an answer key.
 *
 * Key shape (YAML): { visual: { <cueId>: { modality, present, segments: [{ frameIn, frameOut, region }], confidence } },
 *                     speech: { <cueId>: { start, end, confidence } } }
 * Low-confidence key entries are left out of the numbers.
 */

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
function pct(a, q) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function scoreVisual(results, keyVisual) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const status = {};
  const rows = [];
  let routeN = 0; let routeOk = 0;
  for (const [id, k] of Object.entries(keyVisual || {})) {
    const r = byId.get(id);
    if (!r) continue;
    if (k.modality === 'speech') { routeN++; routeOk += ['speech', 'speech-line'].includes(r.kind) ? 1 : 0; continue; }
    if (k.confidence === 'low') continue;
    status[r.status] = (status[r.status] || 0) + 1;
    if (r.status !== 'refined') { rows.push({ id, status: r.status, reason: r.reason || null }); continue; }
    const kin = Math.min(...k.segments.map((s) => s.frameIn)); const kout = Math.max(...k.segments.map((s) => s.frameOut));
    const K = new Set(k.segments.flatMap((s) => range(s.frameIn, s.frameOut)));
    const R = new Set((r.segments || [{ frameIn: r.frameIn, frameOut: r.frameOut }]).flatMap((s) => range(s.frameIn, s.frameOut)));
    const inter = [...R].filter((f) => K.has(f)).length;
    rows.push({ id, status: 'refined', startErr: r.frameIn - kin, endErr: r.frameOut - kout, iou: inter / new Set([...K, ...R]).size });
  }
  const ok = rows.filter((x) => x.status === 'refined');
  const s = ok.map((x) => Math.abs(x.startErr)); const e = ok.map((x) => Math.abs(x.endErr));
  return {
    keyed: Object.values(status).reduce((a, b) => a + b, 0),
    status,
    refined: ok.length,
    within1: ok.filter((x) => Math.abs(x.startErr) <= 1 && Math.abs(x.endErr) <= 1).length,
    within6: ok.filter((x) => Math.abs(x.startErr) <= 6 && Math.abs(x.endErr) <= 6).length,
    offHalfSecond: ok.filter((x) => Math.abs(x.startErr) > 12 || Math.abs(x.endErr) > 12).length,
    startMedian: median(s), startP90: pct(s, 0.9), endMedian: median(e), endP90: pct(e, 0.9),
    iouMedian: median(ok.map((x) => x.iou)),
    routing: { n: routeN, ok: routeOk },
    rows,
  };
}

export function scoreSpeech(results, keySpeech) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const status = {};
  const rows = [];
  for (const [id, k] of Object.entries(keySpeech || {})) {
    const r = byId.get(id);
    if (!r || k.confidence === 'low') continue;
    status[r.status] = (status[r.status] || 0) + 1;
    if (r.status !== 'refined') { rows.push({ id, status: r.status, reason: r.reason || null }); continue; }
    rows.push({ id, status: 'refined', startMs: Math.round((r.in - k.start) * 1000), endMs: Math.round((r.out - k.end) * 1000) });
  }
  const ok = rows.filter((x) => x.status === 'refined');
  const s = ok.map((x) => Math.abs(x.startMs)); const e = ok.map((x) => Math.abs(x.endMs));
  return {
    keyed: Object.values(status).reduce((a, b) => a + b, 0),
    status,
    refined: ok.length,
    within30: ok.filter((x) => Math.abs(x.startMs) <= 30 && Math.abs(x.endMs) <= 30).length,
    within80: ok.filter((x) => Math.abs(x.startMs) <= 80 && Math.abs(x.endMs) <= 80).length,
    startMedian: median(s), startP90: pct(s, 0.9), endMedian: median(e), endP90: pct(e, 0.9),
    rows,
  };
}

function range(a, b) {
  const out = [];
  for (let f = a; f <= b; f++) out.push(f);
  return out;
}
