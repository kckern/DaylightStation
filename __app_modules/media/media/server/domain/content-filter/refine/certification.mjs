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

/**
 * @param {{ cues: Array<{ id: string, type: string, precision?: string }>, certification?: object }} edl
 * @param {{ at: string }} o
 */
export function certify(edl, { at }) {
  const counts = { mute: { precise: 0, safeWindow: 0, approx: 0 }, visual: { precise: 0, approx: 0 } };
  const blocking = [];
  const seen = new Set();
  for (const c of edl.cues || []) {
    // One VidAngel tag can be listed once per category under the same id and span.
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const precise = PRECISE.has(c.precision);
    if (c.type === 'mute') {
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
