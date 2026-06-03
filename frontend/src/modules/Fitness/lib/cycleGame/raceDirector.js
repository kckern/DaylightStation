import { RACE_PANELS } from './racePanels.js';

const ZONES = ['bottom', 'topLeft', 'topCenter', 'topRight'];
const MIN_DWELL_S = 5;       // min time a panel holds a zone before eviction
const CYCLE_DWELL_S = 8;     // rotation dwell when a zone has an overflow pool
const HYSTERESIS = 1.15;     // challenger must beat incumbent score by 15%

const emptyDecision = () => ({
  zones: { bottom: null, topLeft: null, topCenter: null, topRight: null },
  pools: {}, timers: { assignedAt: {}, cycleAt: {} }, transient: {}
});

export function raceDirector(snapshot, prevDecision, clock) {
  const prev = prevDecision || emptyDecision();
  const decision = emptyDecision();
  const scored = RACE_PANELS
    .filter((p) => p.candidacy(snapshot))
    .map((p) => ({ panel: p, score: p.priority(snapshot) }))
    .sort((a, b) => b.score - a.score);

  const taken = new Set();
  const assign = (zone, id) => {
    decision.zones[zone] = id;
    taken.add(zone);
    decision.timers.assignedAt[zone] = (prev.zones[zone] === id && prev.timers.assignedAt[zone] != null)
      ? prev.timers.assignedAt[zone] : clock; // preserve dwell start if unchanged
  };

  // STAGE 2 — transient promotion (highest precedence).
  RACE_PANELS.filter((p) => p.transient).forEach((p) => {
    const t = p.transient;
    const zone = p.zones[0];
    const tr = prev.transient[p.id] || {};
    const triggered = (snapshot.events || []).some((e) => t.triggers.includes(e.type));
    const wasShowing = prev.zones[zone] === p.id;
    const shownAt = tr.shownAt;
    let show = false;
    if (wasShowing) {
      // hold until minHoldS elapses; extend hold if still triggered
      const heldFor = clock - (shownAt ?? clock);
      show = triggered || heldFor < t.minHoldS;
    } else if (triggered) {
      // re-fire only if past cooldown since last show ended
      const lastShown = tr.shownAt ?? -Infinity;
      show = (clock - lastShown) >= t.cooldownS;
    }
    if (show) {
      assign(zone, p.id);
      decision.transient[p.id] = { shownAt: wasShowing ? (shownAt ?? clock) : clock };
    } else {
      decision.transient[p.id] = { shownAt: tr.shownAt }; // remember for cooldown
    }
  });

  // STAGE 3 — greedy resident assignment by score, with dwell + hysteresis.
  const pools = {}; ZONES.forEach((z) => { pools[z] = []; });
  scored.filter(({ panel }) => !panel.transient).forEach(({ panel, score }) => {
    const zone = panel.zones.find((z) => !taken.has(z));
    if (!zone) {
      // no free preferred zone — drop into the first preferred zone's pool
      pools[panel.zones[0]].push({ id: panel.id, score, cycles: panel.cycles });
      return;
    }
    const incumbent = prev.zones[zone];
    const incumbentDwell = clock - (prev.timers.assignedAt[zone] ?? -Infinity);
    if (incumbent && incumbent !== panel.id && incumbentDwell < MIN_DWELL_S) {
      // incumbent still within min dwell — keep it, pool the challenger
      assign(zone, incumbent);
      pools[zone].push({ id: panel.id, score, cycles: panel.cycles });
      return;
    }
    if (incumbent && incumbent !== panel.id) {
      const incScore = (scored.find((s) => s.panel.id === incumbent) || {}).score || 0;
      if (score < incScore * HYSTERESIS) { // not enough to dethrone
        assign(zone, incumbent);
        pools[zone].push({ id: panel.id, score, cycles: panel.cycles });
        return;
      }
    }
    assign(zone, panel.id);
  });

  // STAGE 4 — cycling: a taken zone with >1 pooled candidate and a cycling lead rotates.
  ZONES.forEach((zone) => {
    const pool = (pools[zone] || []).filter((c) => c.cycles).sort((a, b) => b.score - a.score);
    decision.pools[zone] = pool.map((c) => c.id);
    const lead = decision.zones[zone];
    const leadCycles = RACE_PANELS.find((p) => p.id === lead)?.cycles;
    if (!leadCycles || pool.length === 0) { decision.timers.cycleAt[zone] = prev.timers.cycleAt?.[zone] ?? clock; return; }
    const rotation = [lead, ...pool.map((c) => c.id)];
    const cycleStart = prev.timers.cycleAt?.[zone] ?? clock;
    if (clock - cycleStart >= CYCLE_DWELL_S) {
      const curIdx = rotation.indexOf(prev.zones[zone]);
      const next = rotation[(curIdx + 1) % rotation.length];
      assign(zone, next);
      decision.timers.cycleAt[zone] = clock;
    } else {
      decision.timers.cycleAt[zone] = cycleStart;
    }
  });

  return decision;
}

export default raceDirector;
