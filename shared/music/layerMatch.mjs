// layerMatch — rank loop-library candidates for layering onto a base loop.
// Pure, framework-agnostic; operates on index.yml LoopEntry shapes + the theory
// core. Key/tempo are never blockers (canonical MIDI transposes/retempos for
// free) — this scores what sounds good STACKED: role complement, mood/mode
// coherence, same-source affinity, and tempo closeness.

import { signatureKey, areStackable } from './harmonicSignature.mjs';

const ROLE_BY_TYPE = {
  'chord-progression': 'chords',
  melody: 'melody',
  bassline: 'bass',
  idea: 'idea',
};

/** Layering role for a loop entry. */
export function roleOf(entry) {
  return ROLE_BY_TYPE[entry?.type] || 'other';
}

/** 'major' | 'minor' | null, inferred from the first roman numeral's case. */
function modeOf(entry) {
  const first = entry?.roman?.[0];
  if (!first) return null;
  const letter = first.replace(/^[#b]/, '')[0];
  return letter && letter === letter.toLowerCase() ? 'minor' : 'major';
}

const WEIGHTS = { sameSignature: 10, complement: 3, sameRole: -3, mood: 2, mode: 1, source: 1, sameArtist: 2, bpmMax: 1 };

/** Weighted compatibility number for stacking `cand` on `base` (higher = better). */
export function compatibilityScore(base, cand) {
  let score = 0;
  const bSig = signatureKey(base.roman);
  const cSig = signatureKey(cand.roman);
  if (bSig && cSig && bSig === cSig) score += WEIGHTS.sameSignature;
  score += roleOf(cand) === roleOf(base) ? WEIGHTS.sameRole : WEIGHTS.complement;
  if (base.mood && cand.mood && base.mood === cand.mood) score += WEIGHTS.mood;
  const bm = modeOf(base); const cm = modeOf(cand);
  if (bm && cm && bm === cm) score += WEIGHTS.mode;
  if (cand.sources?.some((s) => base.sources?.includes(s))) score += WEIGHTS.source;
  if (base.artist && cand.artist && base.artist === cand.artist) score += WEIGHTS.sameArtist;
  if (base.bpm && cand.bpm) {
    const closeness = 1 - Math.min(Math.abs(base.bpm - cand.bpm), 40) / 40;
    score += closeness * WEIGHTS.bpmMax;
  }
  return score;
}

/** Human-readable reasons a candidate scored well (for UI chips). */
function reasonsFor(base, cand) {
  const reasons = [];
  const bSig = signatureKey(base.roman);
  const cSig = signatureKey(cand.roman);
  if (bSig && cSig && bSig === cSig) reasons.push('same progression');
  if (roleOf(cand) !== roleOf(base)) reasons.push(`adds ${roleOf(cand)}`);
  if (base.mood && cand.mood === base.mood) reasons.push(`${cand.mood} mood`);
  if (base.artist && cand.artist === base.artist) reasons.push('same artist');
  else if (cand.sources?.some((s) => base.sources?.includes(s))) reasons.push('same set');
  if (base.bpm && cand.bpm && Math.abs(base.bpm - cand.bpm) <= 8) reasons.push('tempo match');
  return reasons;
}

const identity = (e) => e.path || e.slug;

/**
 * Rank candidates to layer onto `base`, best first.
 * @param {object} base the chosen base loop
 * @param {object[]} candidates other loop entries
 * @param {{role?:string}} [opts] role filter ('chords'|'melody'|'bass'|'idea')
 * @returns {{entry:object, score:number, reasons:string[]}[]}
 */
export function rankLayerCandidates(base, candidates, opts = {}) {
  return candidates
    .filter((c) => identity(c) !== identity(base))
    .filter((c) => !opts.role || roleOf(c) === opts.role)
    .filter((c) => !opts.onlyStackable || areStackable(base.roman, c.roman))
    .map((c) => ({ entry: c, score: compatibilityScore(base, c), reasons: reasonsFor(base, c), stackable: areStackable(base.roman, c.roman) }))
    .sort((a, b) => b.score - a.score);
}

export default { roleOf, compatibilityScore, rankLayerCandidates };
