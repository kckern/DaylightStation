// enrichIndex — idempotent, non-destructive enrichment of an existing loop
// index.yml. For each entry it classifies the loop's implied harmony from its
// already-ingested .mid and applies enrichEntry (adds signature/barSpan/title,
// and an inferred roman ONLY when none was authored). Unlike the full ingest it
// does NOT reorganize the canonical tree — it only rewrites index.yml, so it is
// safe to re-run. Pure core (enrichIndex) with an injected note loader; the CLI
// wrapper wires @tonejs/midi + yaml IO.
import { classifyHarmony } from './harmonicClassify.mjs';
import { enrichEntry } from './enrichEntry.mjs';

/**
 * Enrich every entry in an index.
 * @param {object[]} entries index.yml entries
 * @param {(entry:object)=>({notes:Array, ppq:number, timeSig:{beats:number,beatType:number}}|null)} loadNotes
 *   returns parsed notes for an entry, or null if unreadable
 * @param {{minConfidence?:number}} [opts]
 * @returns {object[]} new enriched entries (input not mutated)
 */
export function enrichIndex(entries, loadNotes, opts = {}) {
  const { minConfidence = 0.6 } = opts;
  return entries.map((entry) => {
    let classified = null;
    const loaded = loadNotes(entry);
    if (loaded?.notes?.length) {
      classified = classifyHarmony(loaded.notes, {
        ppq: loaded.ppq, beats: loaded.timeSig?.beats ?? 4, beatType: loaded.timeSig?.beatType ?? 4,
      });
    }
    return enrichEntry(entry, { classified, minConfidence });
  });
}

export default { enrichIndex };
