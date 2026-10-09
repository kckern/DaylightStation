// governedContent.js — single source of truth for the fitness governance TRIGGER.
//
// A piece of content is "governed" (HR-gated: you must keep your heart rate in
// zone or playback pauses) iff it carries a governed scope-label, e.g. `KidsFun`.
//
// `governed_types` is a DISCOVERY/eligibility SCOPE, NOT a trigger. It says which
// container types the backend even searches for governed labels — mirroring the
// authoritative backend query `getItemsByLabel(governedLabels, { types })`. A
// content TYPE on its own never governs anything.
//
// Why type can't be a runtime trigger: at playback we play episodes (type
// "episode") and movies (type "movie"), not show containers (type "show").
// Episodes inherit their parent show's labels (see deriveEpisodeLabels in
// FitnessShow), so a label check at playback is exactly equivalent to "the parent
// show is governed". Gating on type instead would (a) lock every show by virtue
// of its type and (b) never lock episodes (their type isn't a container type) —
// the incoherence this module exists to remove.

export const normalizeTag = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

const tagOf = (entry) =>
  typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.tag : '');

// Normalize a list of label strings / `{ tag }` objects into a lower-cased Set.
// A Set passed in is returned as-is (already normalized by the caller).
export function toTagSet(list) {
  if (list instanceof Set) return list;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.map((e) => normalizeTag(tagOf(e))).filter(Boolean));
}

// THE TRIGGER: does this content carry any governed scope-label?
export function hasGovernedLabel(labels, governedLabelSet) {
  const governed = toTagSet(governedLabelSet);
  if (!governed.size) return false; // no governed labels configured → nothing governed
  const own = toTagSet(labels);
  for (const tag of own) if (governed.has(tag)) return true;
  return false;
}

// Container-level (show / movie) governance for the lock-icon affordance: the
// label is the trigger, additionally constrained to `governed_types` when that
// scope is configured (empty scope = any type). Equivalent to the backend's
// getItemsByLabel(governedLabels, { types: governedTypes }).
export function isGovernedContainer({ type, labels } = {}, governedLabelSet, governedTypeSet) {
  if (!hasGovernedLabel(labels, governedLabelSet)) return false;
  const types = toTagSet(governedTypeSet);
  if (types.size > 0) return types.has(normalizeTag(type));
  return true;
}
