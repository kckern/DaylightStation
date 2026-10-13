/**
 * One-time prep for the us-states clickable asset (Wikimedia Commons "Blank US
 * Map (states only)", public domain). Instance tooling; ClickableAsset is generic.
 *  - add a viewBox so the SVG scales responsively
 *  - strip the embedded <style> block (decorative default fills only — our own
 *    School.scss drives all fill/stroke). Necessary, not optional: jsdom's SVG
 *    foreign-content parser mishandles a raw <style> element injected via
 *    dangerouslySetInnerHTML, silently swallowing it AND every sibling that
 *    follows (verified — all 50+ state paths vanish from the parsed DOM).
 *  - remove the raw asset's DC marker <circle class="... dccircle dc">: it has
 *    no data-region-id (clicks on it resolve to nothing) and, with the <style>
 *    block gone, renders unstyled as a stray solid black dot on DC — a fake
 *    affordance for a region this states deck never quizzes.
 *  - tag each state fill path (class="xx", 2 lowercase letters) with data-region-id="XX"
 *  - append tappable callout pucks for the small NE states (offset leader-tabs)
 * Usage: node prepare-us-states.mjs <raw.svg> <out.svg>
 */
import fs from 'node:fs';

// Small dataset states that are too tiny to tap on the map: right-side stack.
const CALLOUTS = { NH: [925, 95], VT: [925, 118], MA: [935, 165], RI: [935, 188],
  CT: [925, 210], NJ: [925, 235], DE: [925, 258], MD: [910, 281] };

let svg = fs.readFileSync(process.argv[2], 'utf8');
svg = svg.replace(/<style[^>]*>[\s\S]*?<\/style>/, '');
svg = svg.replace(/<circle\b[^>]*\bdccircle\b[^>]*>(?:\s*<\/circle>)?/g, '');
svg = svg.replace(/<svg ([^>]*?)>/, (m, attrs) => (attrs.includes('viewBox') ? m : `<svg ${attrs} viewBox="0 0 959 593">`));
svg = svg.replace(/class="([a-z]{2})"/g, (m, code) => `class="${code}" data-region-id="${code.toUpperCase()}"`);
const pucks = Object.entries(CALLOUTS).map(([id, [x, y]]) =>
  `<g class="school-clickable__callout" data-region-id="${id}" tabindex="0" role="button" aria-label="${id}">`
  + `<rect x="${x}" y="${y}" width="26" height="16" rx="3"/>`
  + `<text x="${x + 13}" y="${y + 12}" text-anchor="middle">${id}</text></g>`).join('');
svg = svg.replace('</svg>', `${pucks}</svg>`);
fs.writeFileSync(process.argv[3], svg);
