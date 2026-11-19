// Pure helpers of port-check.mjs, kept apart so they can be tested without the repo.

/** Applies the recorded class renames, then drops package and import lines, trailing space and blank lines. */
export function normalize(text, renames = []) {
  let t = text;
  for (const r of renames) {
    const [from, to] = r.split('=');
    t = t.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  return t.split('\n')
    .filter((l) => !/^\s*(package|import)\s/.test(l))
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

/**
 * Is a ported line the source line? The one change a moved file may carry is a
 * declaration made `public` because its callers now live in another package: the
 * ported line then starts with `public ` where the source line does not. A
 * `public` taken away, or one that differs anywhere else in the line, is a change.
 */
export function sameLine(source, ported) {
  if (source === ported) return true;
  const widened = /^(\s*)public (.*)$/.exec(ported);
  return Boolean(widened) && widened[1] + widened[2] === source;
}

/** How many lines differ between a source and its port, and the first source line that does. */
export function compare(sourceLines, portedLines) {
  let differing = Math.abs(sourceLines.length - portedLines.length);
  let first = null;
  for (let i = 0; i < Math.min(sourceLines.length, portedLines.length); i++) {
    if (!sameLine(sourceLines[i], portedLines[i])) {
      differing++;
      if (first === null) first = sourceLines[i];
    }
  }
  if (first === null && differing > 0) first = '(end of file)';
  return { differing, first };
}

/**
 * The verdict on one row of port-map.tsv. The mode column is checked both ways: a
 * `move` that differs is a failure, and so is an `adapt` that does not differ, since
 * a wrong label hides the next change to that file from this check.
 */
export function judge(mode, differing) {
  if (mode === 'move') return differing === 0 ? { ok: true } : { ok: false, why: 'moved file differs from its source' };
  if (mode === 'adapt') {
    return differing > 0 ? { ok: true }
      : { ok: false, why: 'labelled adapt and identical to its source: label it move' };
  }
  return { ok: false, why: `unknown mode '${mode}' (move or adapt)` };
}
