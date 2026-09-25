/**
 * Why did the auditor's snapshot change? A digest keeps one hash per concern
 * for every row (content, artwork, settlement) so two digests can say which
 * kind of change happened, and whether the only rows that moved are the ones
 * the auditor itself just repaired. Pure; `hash` is injected (domains do no crypto).
 */

// Bookkeeping that moves with any write: a version bump, a timestamp, and the
// provenance a repair stamps next to the field it changed. None of it is a
// change to what was eaten, so it stays out of the content hash.
const BOOKKEEPING = ['version', 'updatedAt', 'createdAt', 'settledAt', 'cleanupFields', 'cleanupEvidence', 'manualFields', 'nutrientProvenance'];
// Tracked on their own (artwork, settlement) so they do not also read as an edit.
const SEPARATE = ['icon', 'photoRef', 'settled', 'settledBy'];
const OMIT = new Set([...BOOKKEEPING, ...SEPARATE]);

/** Row key; matches the `affectedIds` a repair returns (uuid, else id). */
const rowKey = row => row.uuid || row.id;

/** Compact per-class view of an audit snapshot. */
export function snapshotDigest(snapshot, hash) {
  const rows = {};
  for (const row of [...(snapshot.rows || []), ...(snapshot.pending || []).flatMap(log => log.items || [])]) {
    const body = Object.fromEntries(Object.entries(row).filter(([key]) => !OMIT.has(key)));
    if (body.review) body.review = { ...body.review, status: undefined };
    // 16 hex characters is plenty to tell one row's versions apart and keeps the stored digest small.
    rows[rowKey(row)] = {
      body: hash(JSON.stringify(body)).slice(0, 16),
      art: hash(JSON.stringify([row.icon ?? null, row.photoRef ?? null])).slice(0, 16),
      settled: row.settled ?? null, settledBy: row.settledBy ?? null, review: row.review?.status ?? null,
    };
  }
  return { dates: (snapshot.dates || []).join(','), rows, observations: hash(JSON.stringify(snapshot.observations || [])) };
}

/**
 * Which trigger kinds separate two digests; empty set = nothing that matters
 * changed. No previous digest is the daily sweep. A row that left the window is
 * not a trigger. Per row the most specific kind wins: settlement, then
 * content, then artwork.
 */
export function classifyChange(prev, next) {
  if (!prev) return new Set(['dailySweep']);
  const kinds = new Set();
  if (prev.dates !== next.dates) kinds.add('dayRollover');
  if (prev.observations !== next.observations) kinds.add('scaleReconcile');
  for (const [key, row] of Object.entries(next.rows)) {
    const before = prev.rows[key];
    if (!before) { kinds.add('captures'); continue; }
    if (before.settled !== row.settled || before.review !== row.review) kinds.add(row.settledBy === 'user' ? 'reviews' : 'stabilization');
    else if (before.body !== row.body) kinds.add('edits');
    else if (before.art !== row.art) kinds.add('artwork');
  }
  return kinds;
}

/**
 * True when every row difference is one of `ownIds` and nothing else moved. A
 * row that left the window is ignored, as classifyChange ignores it.
 */
export function onlyOwnChanges(prev, next, ownIds) {
  if (!prev || prev.dates !== next.dates || prev.observations !== next.observations) return false;
  for (const [key, row] of Object.entries(next.rows)) {
    if (JSON.stringify(prev.rows[key]) !== JSON.stringify(row) && !ownIds.has(key)) return false;
  }
  return true;
}
