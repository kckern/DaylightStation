/**
 * What an audit saw: a digest of the refined EDL and the household override, minus review
 * marks and the stored certification (marking a row reviewed or signing the film off does not
 * make the audit stale). The Admin sign-off requires
 * the latest audit's digest to match the current one.
 */
import { createHash } from 'crypto';

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** @returns {string} sha1 hex */
export function filterDigest({ refined, override }) {
  const { review: _review, ...rest } = override || {};
  // Loudness of the bleep tone is a playback setting: it changes nothing the audit checked.
  if (rest.profilePatch && typeof rest.profilePatch === 'object') {
    const { bleepLevel: _level, ...patch } = rest.profilePatch;
    if (Object.keys(patch).length) rest.profilePatch = patch; else delete rest.profilePatch; // {} is the same as absent
  }
  // So is one cue's own level; an empty `cueOverrides` is the same as absent.
  if (rest.cueOverrides && typeof rest.cueOverrides === 'object') {
    const cues = {};
    for (const [id, o] of Object.entries(rest.cueOverrides)) {
      const { bleepLevel: _cueLevel, ...kept } = o || {};
      if (Object.keys(kept).length) cues[id] = kept;
    }
    if (Object.keys(cues).length) rest.cueOverrides = cues; else delete rest.cueOverrides;
  }
  const { certification: _cert, ...edl } = refined || {};
  return createHash('sha1').update(stable({ refined: refined ? edl : null, override: rest })).digest('hex');
}
