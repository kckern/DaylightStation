/**
 * Which languages this app can compose in the page.
 *
 * The ladder is defined over ROLES, never language codes, and that is
 * deliberate — a new pair is a corpus file, not a domain change. But an input
 * method is inherently script-specific, so the language literal has to exist
 * somewhere. This is that somewhere: one small registry, at the edge, rather
 * than a language name leaking into the ladder.
 *
 * Everything else is typed plainly by the browser.
 */
export const COMPOSABLE_LANGUAGES = Object.freeze(['KR']);

const SET = new Set(COMPOSABLE_LANGUAGES);

export function canCompose(code) {
  return typeof code === 'string' && SET.has(code.toUpperCase());
}

/**
 * The typing mode a declared language implies. A field that names a language we
 * cannot compose is still DRIVING the mode — it is saying "plain text here" —
 * which is what makes the ladder's interpretation rung turn Korean back off.
 */
export function modeForLanguage(code) {
  if (!code) return null;
  return canCompose(code) ? 'KR' : 'EN';
}
