/**
 * TeX lint for school print documents — the pre-flight that keeps a learner
 * from being the first thing to ever run a bank's math through MathJax.
 *
 * On 2026-09-15 a mastery bank shipped `$230, 240, 250, ___$` (an author's
 * `\_\_\_` inside a JavaScript string, backslashes eaten), and the first
 * render of it was a child's print at the Portal: `Missing open brace for
 * subscript`, three retries, two dead row ranges on his answer card, one
 * card rolled over. Nothing between the generator and the printer had ever
 * rendered the segment. This module is that something.
 *
 * Grammar: `inlineGrammar.mjs`'s `INLINE_SPAN_PLAIN`, the SAME alternation
 * `measure.mjs` measures with, so a `$x$` inside bold or code is literal to
 * both. The `texLint.test.mjs` drift guard compares the two on shared samples.
 * (The v2 italic grammar can only hide MORE math — a `$x$` inside `*…*` — so
 * the plain grammar is the conservative superset to lint.)
 */
import { texToSvg as mathJaxTexToSvg } from './mathSvg.mjs';
import { INLINE_SPAN_PLAIN } from './inlineGrammar.mjs';

/**
 * Block types whose `$…$` the renderer keeps LITERAL (see `CLOZE_SPAN_*` in
 * `measure.mjs`): nothing under them ever reaches MathJax, so nothing under
 * them can fail it.
 */
const LITERAL_MATH_BLOCK_TYPES = new Set(['cloze']);

/**
 * Every inline TeX segment reachable from `value`, depth-first, with a
 * dotted path back to the string that carried it.
 *
 * @param {*} value - a published document, a bank, an item, or a bare string
 * @returns {Array<{path: string, tex: string}>}
 */
export function collectInlineTex(value) {
  const found = [];
  const walk = (node, trail) => {
    if (typeof node === 'string') {
      // `parseRichText` joins a paragraph's lines with a space before it
      // matches spans, so a `$…$` broken across a line break is math to the
      // renderer; a blank line ends the paragraph and the span with it.
      for (const paragraph of node.split(/\n[ \t]*\n/)) {
        const joined = paragraph.replace(/\n/g, ' ');
        INLINE_SPAN_PLAIN.lastIndex = 0;
        let match = INLINE_SPAN_PLAIN.exec(joined);
        while (match) {
          if (match.groups.math !== undefined) found.push({ path: trail, tex: match.groups.math });
          match = INLINE_SPAN_PLAIN.exec(joined);
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${trail}[${index}]`));
      return;
    }
    if (node && typeof node === 'object') {
      if (LITERAL_MATH_BLOCK_TYPES.has(node.type)) return;
      for (const [key, entry] of Object.entries(node)) walk(entry, trail ? `${trail}.${key}` : key);
    }
  };
  walk(value, '');
  return found;
}

/**
 * Render every inline TeX segment in `value` and report the ones MathJax
 * rejects. Each segment renders once per distinct source string; a bank that
 * repeats a prompt does not pay twice.
 *
 * @param {*} value
 * @param {Object} [opts]
 * @param {Function} [opts.texToSvg] - `(tex, {display}) => svg`; throws on a TeX error
 * @returns {string[]} human-readable errors, empty when every segment renders
 */
export function lintTex(value, { texToSvg = mathJaxTexToSvg } = {}) {
  const errors = [];
  const verdicts = new Map();
  for (const { path, tex } of collectInlineTex(value)) {
    if (!verdicts.has(tex)) {
      try {
        texToSvg(tex, { display: false });
        verdicts.set(tex, null);
      } catch (err) {
        verdicts.set(tex, err?.message ?? String(err));
      }
    }
    const verdict = verdicts.get(tex);
    if (verdict) errors.push(`${path}: ${verdict}`);
  }
  return errors;
}

export default lintTex;
