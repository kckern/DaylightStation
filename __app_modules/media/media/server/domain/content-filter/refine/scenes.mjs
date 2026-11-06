/**
 * Scenes: a run of tags that is one continuous situation, with edges on shot
 * cuts. Pure rules only; the questions and the media live in the application
 * layer (SceneBuilder). Design: ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md
 */

/** Groups a scene is judged on; other categories (drugs, language, kissing) form no scene level. */
export const SCENE_GROUPS = ['violence_blood_gore', 'sex_nudity_immodesty', 'sex_any'];
export const TAG_LEAD_SEC = 3;     // an approximate tag can start this much before its time
export const EDGE_REACH_SEC = 12;  // how far an edge may move out to reach a shot cut
export const MIN_PROBES = 8;
export const MAX_PROBES = 24;
export const PROBE_EVERY_SEC = 10;

const PRECISE = new Set(['ms', 'frame']);
const num = (id) => Number(String(id).replace(/\D/g, '')) || 0;
const r3 = (x) => Math.round(x * 1000) / 1000;

/** `sc-` + the smallest member id: stable while that tag stays in the scene. */
export function sceneId(cueIds) {
  return `sc-${[...cueIds].sort((a, b) => num(a) - num(b))[0]}`;
}

/** Scene groups present among categories, in SCENE_GROUPS order. */
export function sceneGroupsOf(categories) {
  const tops = new Set(categories.map((c) => String(c).split('/')[0]));
  return SCENE_GROUPS.filter((g) => tops.has(g));
}

/**
 * Edges from the members' own spans: the last cut at or before the earliest
 * start, the first cut at or after the latest end, each within reach. An
 * approximate member is widened by the tag lead on both sides, a precise one
 * keeps its measured span (or the tag lead, if earlier). Edges always cover
 * every member.
 */
export function sceneEdges({ members, cuts = [], reach = EDGE_REACH_SEC, lead = TAG_LEAD_SEC }) {
  const starts = members.map((m) => {
    const tag = (m.tagIn ?? m.in) - lead;
    return PRECISE.has(m.precision) ? Math.min(m.in, m.tagIn != null ? tag : m.in) : tag;
  });
  const ends = members.map((m) => (PRECISE.has(m.precision) ? m.out : (m.tagOut ?? m.out) + lead));
  const lo = Math.max(0, Math.min(...starts));
  const hi = Math.max(...ends);
  const before = cuts.filter((c) => c <= lo && lo - c <= reach);
  const after = cuts.filter((c) => c >= hi && c - hi <= reach);
  const a = before.length ? Math.max(...before) : null;
  const b = after.length ? Math.min(...after) : null;
  return { in: r3(a ?? lo), out: r3(b ?? hi), edges: a != null && b != null ? 'cut' : 'approx' };
}

/**
 * Times to probe a scene's picture: max(8, one per 10 s), at most 24. Shot
 * middles first, then the middle of the largest remaining gap, repeatedly.
 */
export function probeTimes(scene, cuts = []) {
  const dur = scene.out - scene.in;
  const n = Math.min(MAX_PROBES, Math.max(MIN_PROBES, Math.ceil(dur / PROBE_EVERY_SEC)));
  const bounds = [scene.in, ...cuts.filter((c) => c > scene.in && c < scene.out).sort((a, b) => a - b), scene.out];
  let middles = bounds.slice(1).map((b, i) => r3((bounds[i] + b) / 2));
  if (middles.length > n) middles = Array.from({ length: n }, (_, i) => middles[Math.floor((i * middles.length) / n)]);
  const chosen = [...middles];
  while (chosen.length < n) {
    const pts = [scene.in, ...[...chosen].sort((a, b) => a - b), scene.out];
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > pts[best + 1] - pts[best]) best = i - 1;
    chosen.push(r3((pts[best] + pts[best + 1]) / 2));
  }
  return chosen;
}

/** Picture level: the second-highest frame score, so one odd frame cannot set it. */
export function pictureLevel(scores) {
  const s = [...scores].sort((a, b) => b - a);
  const max = Math.round(s[0] ?? 0);
  const level = Math.round(s[1] ?? s[0] ?? 0);
  return { level, max, outlier: max - level >= 2 };
}

/**
 * Keep scene ids (and so the household's rulings) across re-runs: a new scene
 * sharing at least half its members with a prior one takes that prior id. The
 * draft card carries over only when the member set is unchanged.
 */
export function carryForward(prev = [], next = []) {
  const used = new Set();
  const remaps = [];
  const scenes = next.map((s) => {
    const mine = new Set(s.cues);
    let match = null; let bestShare = 0;
    for (const p of prev) {
      if (used.has(p.id)) continue;
      const shared = p.cues.filter((c) => mine.has(c)).length;
      const share = shared / Math.max(p.cues.length, mine.size);
      if (share >= 0.5 && share > bestShare) { match = p; bestShare = share; }
    }
    if (!match) return s;
    used.add(match.id);
    if (match.id !== s.id) remaps.push({ from: s.id, to: match.id });
    const same = bestShare === 1 && match.cues.length === mine.size;
    const { card: _c, ...rest } = s;
    return { ...rest, id: match.id, ...(same && match.card ? { card: match.card } : {}) };
  });
  return { scenes, remaps };
}
