/**
 * The inline span grammar school print documents are measured and drawn with:
 * `**bold**`, `` `code` ``, `$math$`, and (v2, opt-in) `*italic*`.
 *
 * Lives in its own module so that `texLint.mjs` can recognise EXACTLY the
 * `$…$` spans `measure.mjs` will hand to MathJax — a `$x$` inside bold or
 * code is literal text to the renderer and must be literal to the lint too.
 * `measure.mjs` is the only consumer that draws with these; keep alternation
 * order and group names as they are (see the doctrine on `CLOZE_SPAN_*` in
 * `measure.mjs`: reshuffling a shared pattern silently changes which branch
 * wins for existing text).
 */

/**
 * `**bold**` is tried before the single-star italic alternative at every
 * position, so `**x**` can never be misread as italic-of-`*x*`.
 */
export const INLINE_SPAN_PLAIN = /\*\*(?<bold>[^*]+)\*\*|`(?<code>[^`]+)`|\$(?<math>[^$\n]+)\$/g;

/**
 * v2: adds `*italic*` to the grammar, gated behind `{italic: true}` so v1
 * callers (and every existing golden) parse exactly as before — this pattern
 * is never used unless a caller opts in.
 */
export const INLINE_SPAN_ITALIC = /\*\*(?<bold>[^*]+)\*\*|\*(?<italic>[^*\n]+)\*|`(?<code>[^`]+)`|\$(?<math>[^$\n]+)\$/g;
