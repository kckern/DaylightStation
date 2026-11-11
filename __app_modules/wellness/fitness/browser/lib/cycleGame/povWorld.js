import { formatDistance } from "./formatDistance.js";
import { ordinal, gapToAboveText, finishedMetricText } from "./standingsFormat.js";

const lerp = (a, b, f) => a + (b - a) * (f || 0);

/** Lane offset across the road: single rider centred; N spread evenly over ±halfW*inset. */
export function laneX(idx, n, halfW, inset) {
  if (n <= 1) return 0;
  const span = halfW * inset;
  return -span + (idx * (2 * span)) / (n - 1);
}

/**
 * De-collide the fixed-screen-size rank/gap badges in the POV panel.
 *
 * Rider lateral separation on screen is a function of the panel's HEIGHT alone —
 * three.js `PerspectiveCamera` takes a VERTICAL fov, so the width term cancels
 * out of the projection and a wider panel reveals more road without moving the
 * riders apart. In the tall, narrow POV column that leaves adjacent-rank riders
 * closer together than two badges are wide, and their gap readouts overlap into
 * unreadable mush.
 *
 * Resolution: place nearest-first (so the rider you care about most keeps its
 * natural spot) and push each colliding badge below whatever it hit. Boxes are
 * centred on x and top-anchored at y, matching the `translate(-50%,0)` the
 * renderer applies. Mutates nothing — returns new boxes with resolved `y`.
 *
 * @param {Array<{x:number,y:number,w:number,h:number,dist:number}>} boxes
 * @param {number} gapPx  vertical breathing room between stacked badges
 * @param {Array<{x:number,y:number,w:number,h:number,dist:number,ownerId?:string}>} obstacles
 *   fixed boxes (the rider avatar cards, same centre-x / top-y convention) a badge must not
 *   sit on. An obstacle only moves a badge that is FARTHER than it (the card is drawn on top
 *   of it); a badge never yields to its own rider's card (`ownerId` === badge `id`).
 * @returns {Array} same objects (new refs) ordered nearest-first, `y` resolved
 */
export function resolveBadgeStack(boxes = [], gapPx = 3, obstacles = []) {
  const sorted = [...boxes].sort((a, b) => a.dist - b.dist).map((b) => ({ ...b }));
  const fixed = obstacles.map((o) => ({ ...o, fixed: true }));
  const placed = [...fixed];
  const out = [];
  sorted.forEach((b) => {
    const hits = (q) => !(q.fixed && ((q.ownerId != null && q.ownerId === b.id) || q.dist > b.dist))
      && Math.abs(b.x - q.x) < (b.w + q.w) / 2
      && b.y < q.y + q.h + gapPx
      && b.y + b.h + gapPx > q.y;
    // Each push strictly increases b.y past the box it hit, so this terminates;
    // the pass bound is a backstop against a pathological frame, not a real case.
    for (let pass = 0, moved = true; moved && pass <= placed.length; pass++) {
      moved = false;
      placed.forEach((q) => { if (hits(q)) { b.y = q.y + q.h + gapPx; moved = true; } });
    }
    placed.push(b);
    out.push(b);
  });
  return out;
}

/**
 * Text of a collapsed "+N" badge: the ordinals it stands for. Contiguous ranks read as a
 * range ("4th–6th"), two split ranks as "4th & 6th", a lone rank as "4th" (the layout
 * never collapses one rider, but the text stays honest if asked). Riders without a rank
 * are not named; when none has a rank the badge falls back to "+N".
 */
export function collapsedLabel(ranks = [], count = ranks.length) {
  const rs = [...new Set(ranks.filter((r) => Number.isFinite(r)))].sort((a, b) => a - b);
  if (!rs.length) return count > 1 ? `+${count}` : '1 more';
  if (rs.length === 1) return ordinal(rs[0]);
  const contiguous = rs.every((r, i) => i === 0 || r === rs[i - 1] + 1);
  if (contiguous) return `${ordinal(rs[0])}\u2013${ordinal(rs[rs.length - 1])}`;
  if (rs.length === 2) return `${ordinal(rs[0])} & ${ordinal(rs[1])}`;
  return `${ordinal(rs[0])}\u2013${ordinal(rs[rs.length - 1])}`;
}

/**
 * Leader lines that tie a lifted badge back to its rider's card. A badge that stands
 * directly under its card needs none; one that was pushed sideways or down by the band
 * layout gets a line from the card's bottom edge to the badge's top edge (x clamped onto
 * the badge). Riders folded into a "+N" badge get a line to that badge. Pure.
 *
 * @param {object} args
 * @param {Array<{id:string,x:number,y:number,w:number,h:number}>} args.natural each badge's own spot (centre-x, top-y)
 * @param {Array<{id:string,x:number,y:number}>} args.placed from layoutBadgeBands
 * @param {Array<{x:number,y:number,w:number,h:number,ids:string[]}>} [args.mores]
 * @param {Array<{ownerId:string,x:number,y:number,w:number,h:number}>} args.cards
 * @param {number} [args.slackPx] displacement under which no line is drawn
 * @returns {Array<{id:string,x1:number,y1:number,x2:number,y2:number}>}
 */
export function badgeLeaders({ natural = [], placed = [], mores = [], cards = [], slackPx = 6 } = {}) {
  const nat = new Map(natural.map((b) => [b.id, b]));
  const card = new Map(cards.map((c) => [c.ownerId, c]));
  const lines = [];
  const link = (id, target) => {
    const c = card.get(id); if (!c) return;
    const x1 = c.x;
    const x2 = Math.min(target.x + target.w / 2 - 6, Math.max(target.x - target.w / 2 + 6, x1));
    // Join the nearer pair of edges: card bottom to badge top when the badge hangs below
    // the card, card top to badge bottom when the band was lifted above it.
    const above = target.y + target.h <= c.y;
    lines.push({ id, x1, y1: above ? c.y : c.y + c.h, x2, y2: above ? target.y + target.h : target.y });
  };
  placed.forEach((pl) => {
    const n = nat.get(pl.id); if (!n) return;
    if (Math.abs(pl.x - n.x) <= slackPx && Math.abs(pl.y - n.y) <= slackPx) return;
    link(pl.id, { x: pl.x, y: pl.y, w: n.w, h: n.h });
  });
  mores.forEach((m) => (m.ids || []).forEach((id) => link(id, m)));
  return lines;
}

/** Most badges one screen band shows; the rest collapse into a single "+N" badge. */
export const MAX_BADGES_PER_BAND = 3;

/**
 * Lay out the rank/gap badges of the POV panel by screen band.
 *
 * Riders whose badges would land on top of each other (they overlap sideways and sit
 * within a few badge-heights of each other) form one BAND. A band is shown as one
 * column in RANK order, leader on top, so the order a viewer reads is the order of the
 * race rather than the order the push-down happened to produce. A band of more than
 * `maxStack` badges shows the first `maxStack` by rank and one "+N" badge for the rest.
 * Each band is placed as one block below its riders' cards, pushed below any other
 * card or already-placed block (nearest first), kept inside the panel, and never on the
 * pinned `fixed` boxes (the horizon chip). Pure: no DOM, mutates nothing.
 *
 * @param {object} args
 * @param {Array<{id:string,x:number,y:number,w:number,h:number,dist:number,rank:(number|null)}>} args.boxes
 *   one per visible badge; x is the centre, y the top; `rank` null for riders without one (sorted after ranked riders)
 * @param {Array<{x:number,y:number,w:number,h:number}>} [args.cards] avatar cards (centre-x, top-y): no badge may sit on any of them
 * @param {Array<{x:number,y:number,w:number,h:number}>} [args.fixed] other pinned boxes (centre-x, top-y)
 * @param {{w:number,h:number}} [args.panel] panel size; omitted means no clamping
 * @param {number} [args.gapPx]
 * @param {number} [args.maxStack]
 * @param {{w:number,h:number}} [args.moreSize] box size of a "+N" badge
 * @returns {{ placed:Array<{id:string,x:number,y:number}>, hidden:string[], mores:Array<{x:number,y:number,w:number,h:number,count:number}> }}
 */
export function layoutBadgeBands({ boxes = [], cards = [], fixed = [], panel = null, gapPx = 3, maxStack = MAX_BADGES_PER_BAND, moreSize = { w: 56, h: 30 } } = {}) {
  const list = boxes.map((b) => ({ ...b }));
  // Union-find over "these two badges would collide".
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      const sideways = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
      const inBand = Math.abs(a.y - b.y) < 3 * Math.max(a.h, b.h);
      if (sideways && inBand) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  list.forEach((b, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(b); });

  const rankOf = (b) => (Number.isFinite(b.rank) ? b.rank : Infinity);
  const blocks = [...groups.values()].map((members) => {
    // Leader on top: rank order, ties (and unranked riders) by depth, farthest first.
    const ordered = [...members].sort((a, b) => (rankOf(a) - rankOf(b)) || (b.dist - a.dist));
    // A "+1" names nobody, so a lone overflow rider gets its own badge: the block is the
    // same height either way (maxStack + 1 rows), and the badge says who it is.
    const cap = ordered.length === maxStack + 1 ? maxStack + 1 : maxStack;
    const shown = ordered.slice(0, cap);
    const rest = ordered.slice(cap);
    const rows = shown.map((b) => ({ id: b.id, w: b.w, h: b.h }));
    if (rest.length) rows.push({ id: null, more: rest.length, ids: rest.map((b) => b.id), ranks: rest.map((b) => b.rank), w: moreSize.w, h: moreSize.h });
    const w = Math.max(...rows.map((r) => r.w));
    const h = rows.reduce((n, r) => n + r.h, 0) + gapPx * (rows.length - 1);
    const x = members.reduce((n, b) => n + b.x, 0) / members.length;
    // Below the lowest of the band's own natural spots (each is just under its rider's card).
    const y = Math.max(...members.map((b) => b.y));
    return { rows, hidden: rest.map((b) => b.id), x, y, w, h, dist: Math.min(...members.map((b) => b.dist)) };
  }).sort((a, b) => a.dist - b.dist);

  const margin = 2;
  const obstacles = [...cards, ...fixed];
  const placedBlocks = [];
  const collides = (b, q) => Math.abs(b.x - q.x) < (b.w + q.w) / 2 && b.y < q.y + q.h + gapPx && b.y + b.h + gapPx > q.y;
  const clampX = (x, w) => (panel && panel.w > 0 ? Math.min(panel.w - w / 2 - margin, Math.max(w / 2 + margin, x)) : x);
  const fitsX = (x, w) => !(panel && panel.w > 0) || (x - w / 2 >= margin && x + w / 2 <= panel.w - margin);
  blocks.forEach((b) => {
    const others = () => [...obstacles, ...placedBlocks];
    const naturalX = clampX(b.x, b.w);
    const naturalY = b.y;
    // Settle the block in column `x`: below whatever it hits; off the bottom,
    // lifted into the panel and settled above what it hits instead. Reports
    // whether it ended clean (touching nothing, inside the panel).
    const settleAt = (x) => {
      b.x = x; b.y = naturalY;
      for (let pass = 0, moved = true; moved && pass <= obstacles.length + placedBlocks.length + 1; pass++) {
        moved = false;
        others().forEach((q) => { if (collides(b, q)) { b.y = q.y + q.h + gapPx; moved = true; } });
      }
      if (panel && panel.h > 0 && b.y + b.h > panel.h - margin) {
        b.y = panel.h - margin - b.h;
        for (let pass = 0, moved = true; moved && pass <= obstacles.length + placedBlocks.length + 1; pass++) {
          moved = false;
          others().forEach((q) => { if (collides(b, q)) { b.y = q.y - b.h - gapPx; moved = true; } });
        }
        b.y = Math.max(margin, b.y);
      }
      const inPanel = !(panel && panel.h > 0) || (b.y >= margin && b.y + b.h <= panel.h - margin);
      return { x: b.x, y: b.y, clean: inPanel && !others().some((q) => collides(b, q)) };
    };
    let best = settleAt(naturalX);
    if (!best.clean) {
      // No room in its own column — neither under its riders nor above them
      // without landing on the pinned horizon chip or a nearer rider's card
      // (2026-11-10: a six-rider stack sat on "LEADER +440 m"). Step the
      // column to the side of what is in the way, nearest side first; the
      // leader lines tie it back to its riders. Nothing fits: keep the
      // vertical result.
      const candidates = [];
      others().forEach((q) => {
        candidates.push(q.x - (q.w + b.w) / 2 - gapPx, q.x + (q.w + b.w) / 2 + gapPx);
      });
      const tried = candidates.filter((x) => fitsX(x, b.w))
        .sort((p, q) => Math.abs(p - naturalX) - Math.abs(q - naturalX));
      for (const x of tried) {
        const c = settleAt(x);
        if (c.clean) { best = c; break; }
      }
      if (!best.clean) best = settleAt(naturalX);
    }
    b.x = best.x; b.y = best.y;
    placedBlocks.push(b);
  });

  const placed = []; const hidden = []; const mores = [];
  blocks.forEach((b) => {
    let y = b.y;
    b.rows.forEach((r) => {
      if (r.id != null) placed.push({ id: r.id, x: b.x, y });
      else mores.push({ x: b.x, y, w: r.w, h: r.h, count: r.more, ids: r.ids, label: collapsedLabel(r.ranks, r.more) });
      y += r.h + gapPx;
    });
    hidden.push(...b.hidden);
  });
  return { placed, hidden, mores };
}

/**
 * True when a metre mark sits on a gate (a lap line lands on a 100 m multiple, so
 * "800m" and "LAP 2" would be drawn at the same depth and print over each other):
 * the gate's own label wins and the metre label is dropped.
 */
export function markShadowedByGate(mark, gates = [], toleranceM = 0.6) {
  return gates.some((g) => Math.abs(g.z - mark.z) < toleranceM);
}

/**
 * Gap compression (audit C5): a rider more than ~100 m ahead of the camera
 * anchor would dolly past the max-zoom cap and fog out, so the person you're
 * chasing leaves the screen. We keep true metres inside the identity window
 * (≤ 100 m) and compress everything beyond it logarithmically so the leader
 * ALWAYS renders on-screen. Monotonic and identity for gap ≤ 100 m (so ordinary
 * close racing is untouched); grows without bound but very slowly (a 1 km gap
 * displays as ~226 m). Negative gaps (marks/riders behind the anchor) are
 * identity too. Pure — unit-tested.
 *
 * @param {number} gap  metres ahead of the anchor (may be negative)
 * @returns {number}    displayed metres ahead of the anchor
 */
export function displayGap(gap) {
  if (!(gap > 100)) return gap; // identity ≤ 100 m (and behind the anchor)
  return 100 + 40 * Math.log1p((gap - 100) / 40);
}

/** Displayed distance for a true distance `m`, anchored at the camera-follow point. */
export function displayDist(m, anchorM) {
  return anchorM + displayGap(m - anchorM);
}

/**
 * Per-rider fixed-screen-size badge text: rank ordinal + gap-to-next-above
 * ("2nd · −12 m"), mirroring the StandingsTower (T8) standings so the two
 * panels can never disagree. Rank prefers the container-forwarded live
 * `standings()` placement, falling back to live distance order. The group
 * leader / an out-of-contention rider shows their own metric instead of a
 * gap. A parked rider (idle past the park window) or a no-sensor rider is out
 * of the chase: they read "Parked · 120 m" / "No signal · 120 m" and nobody
 * gaps to them. A finished (non-overtime) rider shows the
 * win-condition-appropriate metric via the shared `finishedMetricText` (a
 * distance race finishes everyone at the same distance, so only finish TIME
 * differentiates finishers — T9 review). Pure — unit-tested.
 *
 * `ranked: false` (the solo layout) drops the rank: every badge is the
 * rider's own distance.
 *
 * `prefix` + `metric` split `gapText` so the panel can print the metric as its
 * own element; `ownDistance` is true when that metric is the rider's own
 * distance (the shared `data-distance-readout` contract).
 *
 * @returns {{ [id]: { rank, ordinal, gapText, prefix, metric, ownDistance, text } }}
 */
export function povBadges({ riderIds = [], riders = {}, riderLive = {}, winCondition = 'distance', ranked = true }) {
  const rows = riderIds.map((id) => {
    const rider = riders[id] || {};
    const live = riderLive[id] || {};
    return {
      id,
      distanceM: Math.max(0, rider.cumulativeDistanceM || 0),
      finishTimeS: Number.isFinite(rider.finishTimeS) ? rider.finishTimeS : null,
      placement: Number.isFinite(live.placement) ? live.placement : null,
      speedKmh: Number.isFinite(live.speedKmh) ? live.speedKmh : 0,
      parked: !!live.parked || !!live.stopped,
      stopped: !!live.stopped,
      noSensor: !!live.noSensor,
      overtime: !!live.overtime,
      finished: !!live.finished || Number.isFinite(rider.finishTimeS),
    };
  });
  if (!ranked) {
    // Solo layout: one live rider and a rival. Nobody is ranked; every badge
    // is the rider's own distance (with the parked / no-signal word if away).
    const out = {};
    rows.forEach((r) => {
      const prefix = r.stopped ? 'Stopped at ' : r.parked ? `${r.noSensor ? 'No signal' : 'Parked'} · ` : '';
      const metric = formatDistance(r.distanceM);
      out[r.id] = {
        rank: null, ordinal: '', gapText: `${prefix}${metric}`, prefix, metric, ownDistance: true, text: `${prefix}${metric}`
      };
    });
    return out;
  }
  const byPlacement = (a, b) => (a.placement ?? 999) - (b.placement ?? 999);
  const byDistanceDesc = (a, b) => b.distanceM - a.distanceM;
  const active = rows
    .filter((r) => !r.parked && !r.overtime && !r.finished)
    .sort((a, b) => byPlacement(a, b) || byDistanceDesc(a, b));

  const out = {};
  let rank = 0;
  active.forEach((r, i) => {
    rank += 1;
    const useRank = r.placement ?? rank;
    const above = active[i - 1];
    const gapText = above
      ? gapToAboveText({ winCondition, gapM: above.distanceM - r.distanceM, abovePaceKmh: above.speedKmh })
      : formatDistance(r.distanceM);
    out[r.id] = { rank: useRank, ordinal: ordinal(useRank), gapText, prefix: '', metric: gapText, ownDistance: !above, text: `${ordinal(useRank)} · ${gapText}` };
  });
  rows.filter((r) => r.finished || r.overtime || r.parked).forEach((r) => {
    const useRank = r.placement ?? null;
    const ord = useRank ? ordinal(useRank) : '';
    const prefix = r.stopped ? 'Stopped at ' : r.parked ? `${r.noSensor ? 'No signal' : 'Parked'} · ` : '';
    const metric = (r.parked || r.overtime)
      ? formatDistance(r.distanceM)
      : finishedMetricText({ winCondition, finishTimeS: r.finishTimeS, distanceM: r.distanceM });
    const gapText = `${prefix}${metric}`;
    const ownDistance = r.parked || r.overtime || winCondition !== 'distance';
    out[r.id] = { rank: useRank, ordinal: ord, gapText, prefix, metric, ownDistance, text: ord ? `${ord} · ${gapText}` : gapText };
  });
  return out;
}

/**
 * Pure race-data → world mapping for the POV road. World is metres; the road
 * recedes into −Z (the camera looks down −Z). Riders are placed at
 * z = −displayDist(distance) — gap-compressed so a far leader stays on-screen
 * (audit C5). ALL riders passed in are placed (including not-yet-moved riders
 * parked at z = 0 for the start-line lineup); the `framingMoved` flag decides
 * whether the camera-framing anchor (leaderZ/lastZ) is computed from moved
 * riders only or the whole grid — the caller flips it on after a start grace so
 * the first frames frame the whole start line. A rider passed with `parked: true`
 * (idle past the park window, or no sensor) stays on the road but never sets the
 * framing: leader/last/anchor come from un-parked riders, or from everyone when
 * the whole field is parked. Each world rider carries `parked`.
 *
 * Metre marks (1 m minor / 10 m major, majors labelled) and lap/finish gates are
 * emitted rider-anchored across [lastPlaceM − behindM, leaderM + aheadM] so the
 * TRAILING rider (whom the camera follows) always rides a labelled road with lap
 * arches — not the leader-anchored blank road the audit found.
 * See ops:docs/superpowers/specs/2026-06-06-pov-grid-threejs-camera-controls-design.md
 *
 * @returns {{ riders, leaderZ, lastZ, leaderM, lastM, anchorM, marks, gates }}
 */
export function povWorld({
  riders = [], frac = 0, laneCount = 0,
  lapLengthM = 0, finishM = null,
  aheadM = 25, behindM = 30, gridMinorM = 1, gridMajorM = 10,
  roadHalfW = 4, laneInset = 0.85, framingMoved = true,
}) {
  const n = laneCount || riders.length;
  const rawRiders = riders.map((r) => {
    const distM = Math.max(0, lerp(r.prev, r.cur, frac));
    return {
      id: r.id, idx: r.idx, isGhost: !!r.isGhost, parked: !!r.parked, distM, x: laneX(r.idx, n, roadHalfW, laneInset),
    };
  });

  if (!rawRiders.length) {
    return { riders: [], leaderZ: 0, lastZ: 0, leaderM: 0, lastM: 0, anchorM: 0, marks: [], gates: [] };
  }

  // Framing anchor: un-parked riders (a parked rider must not stretch the camera),
  // falling back to everyone when the whole field is parked. Within those, moved
  // riders only (a stalled 0 m rider can't crush the scale) unless the caller
  // wants the whole grid framed (start-line grace) or nobody has moved yet.
  const unparked = rawRiders.filter((r) => !r.parked);
  const framingRiders = unparked.length ? unparked : rawRiders;
  const movers = framingRiders.filter((r) => r.distM > 0);
  const framePool = (framingMoved && movers.length) ? movers : framingRiders;
  const frameDists = framePool.map((r) => r.distM);
  const leaderM = Math.max(...frameDists);
  const lastM = Math.min(...frameDists);
  const anchorM = lastM; // the camera follows the trailing framed rider

  const worldRiders = rawRiders.map((r) => ({
    id: r.id, idx: r.idx, isGhost: r.isGhost, parked: r.parked, x: r.x, distM: r.distM,
    z: -displayDist(r.distM, anchorM),
  }));
  const leaderZ = -displayDist(leaderM, anchorM);
  const lastZ = -displayDist(lastM, anchorM);

  // Metre marks: rider-anchored [lastM − behindM (clamped ≥0), leaderM + aheadM].
  const marks = [];
  const startM = Math.max(0, Math.ceil((lastM - behindM) / gridMinorM) * gridMinorM);
  const endM = leaderM + aheadM;
  const majorEvery = Math.max(1, Math.round(gridMajorM / gridMinorM));
  const MAX_MARKS = 4000; // safety bound for a very spread field
  let count = 0;
  for (let m = startM; m <= endM + 1e-6 && count < MAX_MARKS; m += gridMinorM, count++) {
    const mr = Math.round(m / gridMinorM) * gridMinorM;
    const major = (mr / gridMinorM) % majorEvery === 0;
    marks.push({ z: -displayDist(mr, anchorM), m: mr, major, label: major ? `${mr}m` : null });
  }

  // Gates: lap multiples across the same rider-anchored window, never past finish; + finish.
  const gates = [];
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (lap > 0) {
    const finishCap = Number.isFinite(finishM) && finishM > 0 ? finishM : Infinity;
    const nearM = Math.max(0, lastM - behindM);
    const farM = Math.min(leaderM + aheadM, finishCap);
    const firstN = Math.max(1, Math.ceil(nearM / lap));
    for (let k = firstN; k * lap <= farM + 1e-6; k++) {
      const d = k * lap;
      if (Math.abs(d - finishCap) < 1e-6) continue; // the finish draws as its own gate
      gates.push({ z: -displayDist(d, anchorM), lap: k, isFinish: false, label: `LAP ${k}` });
    }
  }
  if (Number.isFinite(finishM) && finishM > 0) {
    gates.push({ z: -displayDist(finishM, anchorM), lap: null, isFinish: true, label: 'FINISH' });
  }

  return { riders: worldRiders, leaderZ, lastZ, leaderM, lastM, anchorM, marks, gates };
}

export default povWorld;
