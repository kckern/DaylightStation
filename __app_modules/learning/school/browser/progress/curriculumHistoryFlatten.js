// curriculumHistoryFlatten.js — tree-to-list flattening for
// CurriculumHistoryOverview.jsx, split out so Fast Refresh can hot-reload the
// overview component on its own.

// Slugs are last-resort labels: page/unit codes (p044) carry no meaning for a
// human and "us" is an acronym, not a word. A real catalog title (via
// `resolveTitle`) always beats this prettifier.
function displayId(value) {
  // A media-library content id ("LessonPlex:6760005") names a video, not a
  // lesson a person would recognise: say what it is, never the number.
  if (/^[A-Za-z]+:\d+$/.test(String(value ?? ''))) return 'Video lesson';
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b[pP]\d{2,4}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bUs\b/g, 'US');
}

export function flattenCurriculumHistory(roots = [], resolveTitle = null) {
  const items = [];
  const visit = (node, ancestors = []) => {
    const label = resolveTitle?.(node) ?? displayId(node.id);
    const trail = [...ancestors, label];
    items.push({ ...node, label, trail, depth: ancestors.length });
    (node.children ?? []).forEach((child) => visit(child, trail));
  };
  roots.forEach((root) => visit(root));
  return items;
}
