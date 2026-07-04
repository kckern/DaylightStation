/**
 * libraryRanking — the brains behind the LibraryBrowser (Task 5.1, design §4/§4b).
 * Pure, no React: builds the kind-aware compatible set for a base loop, then
 * ranks within it. The consonance gate (`stackable`) is the HARD guardrail for
 * harmonic material; grooves are neutral (tempo/feel only, offered everywhere);
 * melodic material is RANKED by `melodyFit`, never gated — fitting *over* a
 * harmony is a matter of degree, not admission.
 *
 * CONTRACT NOTES:
 * - `stackable` THROWS on a missing timeline, by design (pipeline bugs must be
 *   loud). Entries without a `timeline` or flagged `needsReview` are therefore
 *   excluded from guardrailed results BEFORE it is ever called.
 * - Index entries carry FLAT enrichment keys (timeline / timelineRoot /
 *   specificity — see cli/loop-enrich.cli.mjs); the {slots, root, specificity}
 *   timeline shape is reconstructed here.
 * - Timelines are root-relative and key-conformed upstream (the app transposes
 *   loops to a shared root), so slot sets compare directly.
 * - A base WITHOUT a timeline (groove base, or an unenriched pick) cannot gate
 *   anything → unfiltered browse, same as no base at all.
 *
 * PERF: built once per open / base change (~3.2k entries, set-math per pair —
 * measured ~10ms against the real index shape); search and facet filtering
 * happen downstream on the already-built set, never per keystroke.
 */
import { makeStackableGate } from '@shared-music/consonance.mjs';
import { makeMelodyFitScorer } from '@shared-music/melodyFit.mjs';
import { rankLayerCandidates } from '@shared-music/layerMatch.mjs';

/** Same identity rule as layerMatch: path is canonical, slug the fallback. */
export const entryIdentity = (e) => e?.path || e?.slug;

// Single-voice LINE material — melodies, motific ideas, and basslines — is
// RANKED by melodyFit over the harmony, never hard-gated. A monophonic line
// fitting over a chord is a matter of degree, not admission (design §4). The
// union-consonance gate (consonance.mjs) is for stacking independent HARMONIC
// layers; applied to a bass it wrongly blames the single low root for the
// chord's OWN busy/clustered slots (e.g. a chord slot {0,2,4,6,7,9} is already
// non-nameable, so no bass note can rescue the union) — that rejected ~90% of
// chord loops' basslines, making bass effectively un-addable. melodyFit scores
// the bass root against the harmony (chord-tone/diatonic/chromatic) instead, so
// a bass tracking the chord roots ranks top and clashers rank low but stay
// offered.
const LINE_TYPES = new Set(['melody', 'idea', 'bassline']);

/**
 * Reconstruct the harmonicTimeline shape from an index entry's flat
 * enrichment keys, or null when the entry is unenriched.
 */
export function timelineOf(entry) {
  if (!Array.isArray(entry?.timeline)) return null;
  return { slots: entry.timeline, root: entry.timelineRoot ?? 0, specificity: entry.specificity ?? null };
}

/**
 * Build the guardrailed candidate set for a base entry.
 *
 * - baseEntry null (or without a usable timeline) → every entry passes.
 * - baseEntry with a timeline:
 *   · grooves ALWAYS pass (no harmonic content to clash),
 *   · single-voice LINE entries (melody/idea/bassline) pass iff enriched
 *     (timeline present, !needsReview), tagged with `fit` = melodyFit(entry,
 *     base) for ranking — never hard-gated (see LINE_TYPES note),
 *   · harmonic entries (chord progressions) pass iff enriched AND
 *     stackable(base, entry).ok.
 * - The base entry itself is never offered back.
 *
 * @param {{entries:object[], baseEntry:object|null}} args
 * @returns {{entry:object, stackable:boolean, fit?:number, reasons:string[]}[]}
 *   only the PASSING entries; `stackable` is true throughout (the gate already
 *   ran) — it exists so downstream "show all" views can mix in false rows.
 */
export function buildCompatibleSet({ entries, baseEntry }) {
  const list = entries || [];
  const baseTl = baseEntry ? timelineOf(baseEntry) : null;
  const baseId = baseEntry ? entryIdentity(baseEntry) : null;

  if (!baseTl) {
    // Unfiltered browse: no base, a groove base, or an unenriched base —
    // nothing to gate against.
    return list
      .filter((entry) => entryIdentity(entry) !== baseId || baseId == null)
      .map((entry) => ({ entry, stackable: true, reasons: [] }));
  }

  // Curried scorers: the base side (slot masks / scale heuristic + per-slot
  // Sets) is computed ONCE here, not per candidate (~1.6k harmonic gates,
  // ~1.5k melodic fits per build).
  const gate = makeStackableGate(baseTl);
  const scoreFit = makeMelodyFitScorer(baseTl);

  const out = [];
  for (const entry of list) {
    if (entryIdentity(entry) === baseId) continue;
    if (entry.type === 'groove') {
      out.push({ entry, stackable: true, reasons: [] });
      continue;
    }
    // From here on a timeline is required — stackable/melodyFit THROW on
    // missing timelines (their documented contract), so unenriched or
    // flagged entries are excluded up front, never fed in.
    const tl = timelineOf(entry);
    if (!tl || entry.needsReview) continue;
    if (LINE_TYPES.has(entry.type)) {
      out.push({ entry, stackable: true, fit: scoreFit(tl), reasons: [] });
      continue;
    }
    if (gate(tl).ok) {
      out.push({ entry, stackable: true, reasons: [] });
    }
  }
  return out;
}

/**
 * THE BLEND: sort key = layerMatch compatibility score + fit × FIT_WEIGHT.
 * Invariant: a Δfit of 0.5 must outrank a full mood-match edge (layerMatch's
 * mood weight is 2) — a clearly better-fitting melody beats one that merely
 * shares the mood tag. That requires FIT_WEIGHT > 4 (at exactly 4 the case
 * ties); 5 gives fit the deciding vote without drowning mood/complement
 * signals entirely.
 */
const FIT_WEIGHT = 5;

/**
 * Rank a compatible set for display: layerMatch mood/feel/complement scoring
 * within the set, melodic results additionally weighted by their fit.
 *
 * @param {{entry:object, stackable:boolean, fit?:number}[]} results
 *   output of buildCompatibleSet (any {entry,...} rows work — "show all"
 *   views may include stackable:false rows, ranked the same way)
 * @param {object|null} baseEntry
 * @returns ranked copies with `score` (layerMatch), `reasons`, `sortKey`;
 *   the input array unchanged (and returned as-is when baseEntry is null —
 *   there is nothing to score against, library order stands).
 */
export function rankCompatible(results, baseEntry) {
  if (!baseEntry) return results;
  const byId = new Map(results.map((r) => [entryIdentity(r.entry), r]));
  return rankLayerCandidates(baseEntry, results.map((r) => r.entry))
    .map(({ entry, score, reasons }) => {
      const row = byId.get(entryIdentity(entry));
      return {
        ...row,
        score,
        reasons,
        // NB: spread order matters — rankLayerCandidates also emits a legacy
        // roman-label `stackable`; `...row` (consonance verdict) wins because
        // the legacy field is never spread in.
        sortKey: score + (row.fit != null ? row.fit * FIT_WEIGHT : 0),
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey);
}

export default { buildCompatibleSet, rankCompatible, timelineOf, entryIdentity };
