/**
 * PianoSpeakerRecoveryPolicy — what to do about the piano's Bluetooth speaker
 * (the "J2-USB Bluetooth" A2DP sink) given what the bridge supervisor saw this
 * tick. Pure: no I/O, the caller supplies `now`.
 *
 * Why a ladder (2026-10-23): when the dongle wedges it accepts the baseband page
 * but refuses L2CAP (`SDP conn cnf error 0x4`), so the APK's own 20 s connect()
 * retry can never succeed. A tablet Bluetooth off→on fixed it once; a piano power
 * cycle always does, and the piano powers itself on when its plug comes back.
 * See ops:docs/superpowers/specs/2026-10-23-piano-speaker-self-healing-design.md.
 *
 * @module learning/piano/server/application/services/PianoSpeakerRecoveryPolicy
 */

export const SPEAKER_LADDER = Object.freeze([
  Object.freeze({ rung: 1, action: 'a2dpReconnect', checkAfterMs: 15_000 }),
  // The one BT-cycle recovery on record took 55 s from Bluetooth-on to A2DP up
  // (2026-10-23 19:56:53 → 19:57:48); a shorter window judges a working cycle
  // failed and the next rung tears it down.
  Object.freeze({ rung: 2, action: 'btCycle', settleMs: 5_000, checkAfterMs: 75_000 }),
  Object.freeze({ rung: 3, action: 'btCycle', settleMs: 15_000, checkAfterMs: 90_000 }),
  Object.freeze({ rung: 4, action: 'plugCycle', offMs: 10_000, checkAfterMs: 60_000 }),
  Object.freeze({ rung: 5, action: 'plugCycle', offMs: 30_000, checkAfterMs: 90_000 }),
]);

export const SPEAKER_POLICY_DEFAULTS = Object.freeze({
  debounceTicks: 2,
  healthyResetMs: 10 * 60_000,
  giveUpBackoffMs: 60 * 60_000,
  maxPlugCyclesPerHour: 2,
  plugAvailable: true,
});

const HOUR_MS = 60 * 60_000;
const NONE = Object.freeze({ type: 'none' });

/** Config arrives straight from YAML; an absent key must not erase a default. */
function withDefaults(options = {}) {
  const out = { ...SPEAKER_POLICY_DEFAULTS };
  for (const [k, v] of Object.entries(options)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

export function initialSpeakerEpisode() {
  return {
    phase: 'ok', downTicks: 0, droppedAt: null, rung: 0, checkAt: 0,
    lastAction: null, healthySince: null, plugCycles: [], gaveUpAt: null, alerted: false,
  };
}

/** What the kiosk banner and the bus see. A told person stays "needs-help" until it is back. */
export function speakerPublicState(episode) {
  if (episode.phase === 'ok') return 'ok';
  return episode.alerted ? 'needs-help' : 'recovering';
}

export function decideSpeaker(episode, observation, now, options) {
  const cfg = withDefaults(options);
  const ep = { ...episode, plugCycles: episode.plugCycles.filter((t) => now - t < HOUR_MS) };
  const { speaker, pianoPower, bridgeUp } = observation;

  // Bridge down is the down episode's problem; an unknown reading is no reading.
  if (!bridgeUp || typeof speaker !== 'boolean') return { episode: ep, action: NONE };

  if (speaker) {
    if (ep.phase !== 'ok') {
      return {
        episode: {
          ...ep, phase: 'ok', downTicks: 0, checkAt: 0, lastAction: null,
          healthySince: now, gaveUpAt: null, alerted: false,
        },
        action: {
          type: 'recovered', rung: ep.rung, alerted: ep.alerted,
          durationMs: ep.droppedAt == null ? null : now - ep.droppedAt,
        },
      };
    }
    // Only a long healthy stretch earns a fresh ladder; a flapping dongle keeps climbing.
    const healthySince = ep.healthySince ?? now;
    const rung = ep.rung > 0 && now - healthySince >= cfg.healthyResetMs ? 0 : ep.rung;
    return { episode: { ...ep, downTicks: 0, healthySince, rung }, action: NONE };
  }

  // Our own plug cycle reads as "piano off" — keep waiting for its check.
  const waitingOnPlug = ep.phase === 'recovering' && ep.lastAction === 'plugCycle';
  if (waitingOnPlug && now < ep.checkAt) return { episode: ep, action: NONE };

  if (pianoPower === 'off') {
    if (waitingOnPlug) return giveUp(ep, now, 'piano-stayed-off');
    // Switching the piano off power-cycles the dongle too — the next power-on gets a
    // fresh ladder, never a carried-over plug rung seconds after someone sits down.
    if (ep.phase === 'recovering') {
      return {
        episode: { ...ep, phase: 'ok', downTicks: 0, checkAt: 0, lastAction: null, healthySince: null, rung: 0 },
        action: { type: 'ended', rung: ep.rung },
      };
    }
    if (ep.phase === 'ok') return { episode: { ...ep, downTicks: 0, healthySince: null, rung: 0 }, action: NONE };
    return { episode: { ...ep, downTicks: 0, healthySince: null }, action: NONE };
  }

  if (ep.phase === 'ok') {
    const downTicks = ep.downTicks + 1;
    if (downTicks < cfg.debounceTicks) return { episode: { ...ep, downTicks, healthySince: null }, action: NONE };
    return nextRung({ ...ep, downTicks, healthySince: null, phase: 'recovering', droppedAt: now }, pianoPower, now, cfg, true);
  }
  if (ep.phase === 'recovering') {
    if (now < ep.checkAt) return { episode: ep, action: NONE };
    return nextRung(ep, pianoPower, now, cfg, false);
  }
  // needs-help: stay quiet for the backoff, then try the whole ladder again.
  if (now - ep.gaveUpAt >= cfg.giveUpBackoffMs) {
    return nextRung({ ...ep, phase: 'recovering', rung: 0 }, pianoPower, now, cfg, false);
  }
  return { episode: ep, action: NONE };
}

function nextRung(ep, pianoPower, now, cfg, opened) {
  const skipped = [];
  for (let r = ep.rung + 1; r <= SPEAKER_LADDER.length; r += 1) {
    const step = SPEAKER_LADDER[r - 1];
    if (step.action === 'plugCycle') {
      const reason = !cfg.plugAvailable ? 'no-plug'
        : pianoPower !== 'on' ? 'power-unknown'
          : ep.plugCycles.length >= cfg.maxPlugCyclesPerHour ? 'plug-cap'
            : null;
      if (reason) { skipped.push({ rung: r, reason }); continue; }
    }
    return {
      episode: {
        ...ep, rung: r, checkAt: now + step.checkAfterMs, lastAction: step.action,
        plugCycles: step.action === 'plugCycle' ? [...ep.plugCycles, now] : ep.plugCycles,
      },
      action: { type: 'attempt', step, opened, skipped },
    };
  }
  return giveUp({ ...ep, rung: SPEAKER_LADDER.length }, now, 'ladder-exhausted', skipped, opened);
}

function giveUp(ep, now, reason, skipped = [], opened = false) {
  return {
    episode: { ...ep, phase: 'needs-help', checkAt: 0, lastAction: null, gaveUpAt: now, alerted: true },
    action: { type: 'gave-up', reason, notify: !ep.alerted, skipped, opened },
  };
}

/** The plug port could not restore power: stop climbing and say so now. */
export function forceGiveUp(episode, now, reason) {
  return giveUp(episode, now, reason);
}
