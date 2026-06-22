// backend/src/2_domains/ambient/evaluateAmbientSchedule.mjs
// Pure reconciliation. Given today's windows, the current local time parts,
// persisted state, and per-device idle booleans, return the actions to take and
// the next state. No I/O, no clock, no logging.
//
// Action types: 'load' | 'powerOff' | 'skip' | 'release' | 'none'.

export function evaluateAmbientSchedule({ windows, now, state, idleByDevice, firstTick }) {
  const actions = [];

  // Next state keeps only today's handled map (prunes prior days).
  const today = { ...((state.handled && state.handled[now.dateStr]) || {}) };
  const next = {
    owned: state.owned ? { ...state.owned } : null,
    handled: { [now.dateStr]: today },
  };

  for (const w of windows) {
    if (!w.days.includes(now.dow)) continue;
    const h = { ...(today[w.key] || { startHandled: false, endHandled: false }) };

    // START edge.
    if (now.minutes >= w.startMin && !h.startHandled) {
      h.startHandled = true;
      if (firstTick) {
        // Boot catch-up: the start already passed before we were watching. Never
        // act retroactively (no surprise power-on after a restart).
        actions.push({ type: 'skip', reason: 'boot-catchup', key: w.key, device: w.device });
      } else if (idleByDevice[w.device]) {
        actions.push({ type: 'load', key: w.key, device: w.device, display: `art:${w.preset}`, preset: w.preset });
        next.owned = { key: w.key, device: w.device, preset: w.preset, startedAt: now.iso };
      } else {
        actions.push({ type: 'skip', reason: 'active-content', key: w.key, device: w.device });
      }
    }

    // END edge.
    if (now.minutes >= w.endMin && !h.endHandled) {
      h.endHandled = true;
      if (next.owned && next.owned.key === w.key) {
        if (idleByDevice[w.device]) {
          actions.push({ type: 'powerOff', key: w.key, device: w.device });
        } else {
          actions.push({ type: 'release', key: w.key, device: w.device, reason: 'active-at-end' });
        }
        next.owned = null;
      } else {
        actions.push({ type: 'none', key: w.key, device: w.device });
      }
    }

    today[w.key] = h;
  }

  return { actions, state: next };
}

export default evaluateAmbientSchedule;
