/**
 * The `classical` surround theme — the concert-hall look (curtain, programme
 * stock, mahogany, the Garamonds) — as a public entry of the media module.
 *
 * The playback capability's `SurroundFrame` is neutral; a definition wears this
 * look only when it names it (`definition.theme: CLASSICAL_SURROUND_THEME`).
 * Importing this file loads the theme's stylesheet. `surround/builtins.js`
 * imports it, so every frame mounted through `SurroundHost` has it; a host that
 * mounts `SurroundFrame` directly (the school's lesson and reading screens) and
 * names this theme imports it itself.
 */
import "./surround/themes/classical.scss";

export const CLASSICAL_SURROUND_THEME = 'classical';
