// cli/midi-ingest/enrichEntry.mjs
// Non-destructive enrichment of an index.yml loop entry: adds signature, barSpan,
// title, and (only when authored roman is absent AND the classifier is confident)
// an inferred roman. Never overwrites an authored roman.
import { signatureKey } from '../../shared/music/harmonicSignature.mjs';

const NOISE = /(niko|kotoulas|intense|awesome|perfect5th|perfect-5th|arp)/gi;

/** Human display title from a slug: strip degree digits, bpm, known noise words. */
export function titleFromSlug(slug) {
  const cleaned = (slug || '')
    .replace(/\d+bpm/gi, '')
    .replace(/\b\d+([-.]\d+)*\b/g, '')
    .replace(NOISE, '')
    .split('-')
    .map((w) => w.trim())
    .filter(Boolean);
  const words = cleaned.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (words.length <= 3) return words.join(' ');
  const mid = Math.ceil(words.length / 2);
  return `${words.slice(0, mid).join(' ')} · ${words.slice(mid).join(' ')}`;
}

export function enrichEntry(entry, { classified = null, minConfidence = 0.6 } = {}) {
  const out = { ...entry };
  const hasAuthoredRoman = Array.isArray(entry.roman) && entry.roman.length > 0;

  if (!hasAuthoredRoman && classified && classified.confidence >= minConfidence) {
    out.roman = classified.roman;
    out.barSpan = classified.barSpan;
    out.harmonyConfidence = classified.confidence;
  }
  out.signature = signatureKey(out.roman);
  out.title = titleFromSlug(entry.slug);
  return out;
}

export default { enrichEntry, titleFromSlug };
