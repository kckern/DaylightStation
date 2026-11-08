/**
 * Whether a refined EDL is ready to play.
 *
 * machine: every mute covers its word: pinned to ms/frame precision, or a safe
 *          window wide enough for the tag's measured drift (safeWindow.mjs).
 *          Skips and visual cues may stay approximate: the player already
 *          widens those generously.
 * parent:  a person reviewed it and signed off; kept only while the machine
 *          bar still holds (a later refine that leaves a mute approximate
 *          drops it).
 * none:    anything else, including every raw VidAngel EDL.
 */
export const LEVELS = ['none', 'machine', 'parent'];
export const BAR = 'every-mute-covered';
const PRECISE = new Set(['ms', 'frame']);

const hasNudge = (ov) => Number.isFinite(ov?.startMs) && Number.isFinite(ov?.endMs);

/**
 * Whether a household nudge (`startMs`/`endMs`, VidAngel clock) covers a mute.
 * On an ms/frame cue it must contain the measured word; on any other cue the
 * nudge is the pin (a person placed it on the word) — owner's ruling 2026-11-07.
 */
export function nudgeCovers(cue, ov) {
  if (!hasNudge(ov) || ov.startMs >= ov.endMs) return false;
  if (!PRECISE.has(cue.precision)) return true;
  return ov.startMs <= Math.round(cue.in * 1000) && ov.endMs >= Math.round(cue.out * 1000);
}

/**
 * @param {{ cues: Array<{ id: string, type: string, precision?: string }>, certification?: object }} edl
 * @param {{ at: string, cueOverrides?: object }} o  household nudges count (nudgeCovers)
 */
export function certify(edl, { at, cueOverrides = {} }) {
  const counts = { mute: { precise: 0, safeWindow: 0, approx: 0 }, visual: { precise: 0, approx: 0 } };
  const blocking = [];
  const seen = new Set();
  for (const c of edl.cues || []) {
    // One VidAngel tag can be listed once per category under the same id and span.
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const precise = PRECISE.has(c.precision);
    const ov = cueOverrides?.[c.id];
    if (c.type === 'mute' && hasNudge(ov)) {
      const covers = nudgeCovers(c, ov);
      counts.mute[!covers ? 'approx' : precise ? 'precise' : 'safeWindow']++;
      if (!covers) blocking.push(c.id);
    } else if (c.type === 'mute') {
      // A safe window (wide enough for the tag's measured drift) also keeps the word from playing.
      // 'pinned': a person marked the word and the span covers it, without ms edges.
      const kind = precise ? 'precise' : (c.precision === 'safe-window' || c.precision === 'pinned') ? 'safeWindow' : 'approx';
      counts.mute[kind]++;
      if (kind === 'approx') blocking.push(c.id);
    } else {
      counts.visual[precise ? 'precise' : 'approx']++;
    }
  }
  const machineOk = blocking.length === 0;
  const parent = machineOk ? edl.certification?.parent : undefined;
  return {
    level: parent ? 'parent' : machineOk ? 'machine' : 'none',
    bar: BAR,
    counts,
    ...(machineOk ? { machine: { at } } : { blocking }),
    ...(parent ? { parent } : {}),
  };
}

/** Record a person's sign-off; only a machine-certified EDL can be signed. */
export function signOff(edl, { by, at }) {
  const c = edl.certification;
  if (!c || !LEVELS.includes(c.level) || c.level === 'none') {
    throw new Error('Only a machine-certified EDL can be signed off (every mute must be covered first)');
  }
  return { ...c, level: 'parent', parent: { by, at } };
}
