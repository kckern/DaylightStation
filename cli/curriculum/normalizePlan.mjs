// cli/curriculum/normalizePlan.mjs — pure normalization planning (no I/O).

// A "part" is a trailing integer after an optional en/em/hyphen dash separator,
// OR a bare trailing integer preceded by a space. "2-5-1" and leading "5 Jazz…"
// are safe because we only strip a SPACE-separated trailing integer.
export function baseCourseAndPart(course) {
  const s = String(course || '').trim();
  const dash = s.match(/^(.*\S)\s+[–—-]\s+(\d+)$/);   // "Name – 2"
  if (dash) return { base: dash[1].trim(), part: Number(dash[2]) };
  const bare = s.match(/^(.*\S)\s+(\d+)$/);            // "Name 2"
  if (bare) return { base: bare[1].trim(), part: Number(bare[2]) };
  return { base: s, part: null };
}
