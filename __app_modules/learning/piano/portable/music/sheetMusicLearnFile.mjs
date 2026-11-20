/**
 * The per-score Learn file: approved segments the kiosk plays, plus an admin-only
 * draft. `start`/`end` are positions in the kiosk's layout.measures array, inclusive.
 * See __docs/reference/piano/sheet-music-player.md ("Learn file").
 */
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

function cleanSegment(raw) {
  if (!isObject(raw)) return null;
  const out = { id: typeof raw.id === 'string' ? raw.id.trim() : '', start: raw.start, end: raw.end };
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim();
  if (Array.isArray(raw.ladder)) out.ladder = raw.ladder;
  return out;
}

const cleanSegments = (list) => (Array.isArray(list) ? list.map(cleanSegment).filter(Boolean) : []);

/**
 * Errors as [{ code, id, index }], where `id` is the trimmed segment id or null and
 * `index` is the position in the input array (-1 for whole-input errors such as
 * `not-array` and `bad-measure-count`). A segment can carry several errors. Per-segment
 * errors come back in input order; overlap errors follow. Empty array = valid.
 */
export function validateSegments(segments, measureCount) {
  if (!Array.isArray(segments)) return [{ code: 'not-array', id: null, index: -1 }];
  if (!Number.isInteger(measureCount) || measureCount < 1) return [{ code: 'bad-measure-count', id: null, index: -1 }];
  const errors = [];
  const seen = new Set();
  const wellFormed = [];
  segments.forEach((raw, index) => {
    const s = isObject(raw) ? raw : {};
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    if (!id) errors.push({ code: 'missing-id', id: null, index });
    else if (seen.has(id)) errors.push({ code: 'duplicate-id', id, index });
    if (id) seen.add(id);
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) { errors.push({ code: 'not-integer', id: id || null, index }); return; }
    if (s.end < s.start) { errors.push({ code: 'reversed', id: id || null, index }); return; }
    if (s.start < 0 || s.end >= measureCount) errors.push({ code: 'out-of-range', id: id || null, index });
    wellFormed.push({ id: id || null, start: s.start, end: s.end, index });
  });
  // Overlap among well-formed ranges only; compare against the furthest end so far so a
  // long segment catches every range nested inside it.
  wellFormed.sort((a, b) => a.start - b.start || a.end - b.end);
  let maxEnd = -Infinity;
  for (const s of wellFormed) {
    if (s.start <= maxEnd) errors.push({ code: 'overlap', id: s.id, index: s.index });
    maxEnd = Math.max(maxEnd, s.end);
  }
  return errors;
}

export function normalizeLearnFile(raw) {
  const file = isObject(raw) ? raw : {};
  const draft = isObject(file.draft) ? {
    segments: cleanSegments(file.draft.segments),
    ...(isObject(file.draft.proposal) ? { proposal: file.draft.proposal } : {}),
  } : null;
  return {
    version: 1,
    scoreId: typeof file.scoreId === 'string' ? file.scoreId : null,
    contentSha256: typeof file.contentSha256 === 'string' ? file.contentSha256 : null,
    segments: cleanSegments(file.segments),
    approved: isObject(file.approved) ? file.approved : null,
    draft,
  };
}

/**
 * The segments the kiosk should play, or null. With `contentSha256` given, a file cut
 * against different XML is stale and yields null.
 */
export function approvedSegments(file, contentSha256) {
  const f = normalizeLearnFile(file);
  if (!f.segments.length) return null;
  if (contentSha256 !== undefined && f.contentSha256 !== contentSha256) return null;
  // Structural errors (ids, integers, reversed, overlap) make the file unplayable.
  if (validateSegments(f.segments, Number.MAX_SAFE_INTEGER).length) return null;
  return [...f.segments].sort((a, b) => a.start - b.start);
}

const sameRange = (a, b) => a.start === b.start && a.end === b.end;

/** What approving `segments` does to one learner's stored coach summary. */
export function approvalImpact(summary, rawSegments) {
  const segments = Array.isArray(rawSegments) ? rawSegments : [];
  const passages = Array.isArray(summary?.passages) ? summary.passages : [];
  const kept = passages.filter((p) => segments.some((s) => sameRange(s, p)));
  const orphaned = passages.filter((p) => !segments.some((s) => sameRange(s, p)));
  // wasAllGold reads the summary counters (what the server's Polish check uses today);
  // allGoldAfter reads the passages themselves.
  const wasAllGold = Number.isInteger(summary?.total) && summary.total > 0 && summary.gold === summary.total;
  const allGoldAfter = segments.length > 0
    && segments.every((s) => kept.some((p) => sameRange(s, p) && p.gold));
  return {
    kept, orphaned,
    lostSilver: orphaned.filter((p) => p.silver).length,
    lostGold: orphaned.filter((p) => p.gold).length,
    wasAllGold, allGoldAfter,
  };
}
