// Pure helpers for the Art admin: validate crop anchors, merge a metadata patch
// into a work's metadata.yaml string, and filter a work list. No IO.
import yaml from 'js-yaml';

// Mirrors the frontend cropFocus vocabulary (artModes.js): up to two of
// top/bottom/left/right/center, or N% tokens. null = "clear the anchor".
const ANCHOR_KEYWORDS = new Set(['top', 'bottom', 'left', 'right', 'center']);
export function isValidAnchor(anchor) {
  if (anchor == null) return true;
  if (typeof anchor !== 'string') return false;
  const tokens = anchor.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 2) return false;
  return tokens.every((t) => ANCHOR_KEYWORDS.has(t) || /^\d{1,3}%$/.test(t));
}

// Fields the admin is allowed to write. Anything else in metadata.yaml is preserved.
const WRITABLE = new Set([
  'title', 'artist', 'date', 'medium', 'category', 'display',
  'crop_anchor', 'tags', 'exclude', 'hidden', 'flagged',
]);

// Read-merge-write: parse the raw YAML, apply the patch (null deletes a key),
// validate, and dump back. Preserves every key the patch doesn't touch.
// (js-yaml does not preserve comments; metadata.yaml files are plain data.)
export function mergeWorkMetadata(raw, patch = {}) {
  const doc = yaml.load(raw) || {};
  if ('crop_anchor' in patch && !isValidAnchor(patch.crop_anchor)) {
    throw new Error(`Invalid crop_anchor: ${patch.crop_anchor}`);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!WRITABLE.has(k)) continue;
    if (v == null) delete doc[k];
    else doc[k] = v;
  }
  return yaml.dump(doc, { lineWidth: -1 });
}

// In-memory list filtering for GET /works.
export function filterWorks(works, { tag, hidden, flagged, q } = {}) {
  const needle = q ? String(q).toLowerCase() : null;
  return works.filter((w) => {
    const m = w.meta || {};
    if (tag && !(Array.isArray(m.tags) && m.tags.includes(tag))) return false;
    if (hidden === true && m.hidden !== true) return false;
    if (flagged === true && m.flagged !== true) return false;
    if (needle) {
      const hay = `${m.title ?? ''} ${m.artist ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export default { isValidAnchor, mergeWorkMetadata, filterWorks };
