import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The guardrail. This is what stops a fourth generation of game chrome.
 *
 * Eight games shipped six palettes, because nothing failed when one of them
 * wrote `#071526aa` where another wrote `#071526b8`, or when four separate games
 * each picked their own neon for "you scored" — `#00ffc8`, `#38f0cf`,
 * `#72f1b8`, and the house `#2ec46f`, all meaning the same thing on the same
 * kiosk. Chess's own file was 76% tokenized; the other seven were 0%.
 *
 * THE RULE: a colour a game names must be NAMED — declared as a custom property,
 * in one palette block, in the file that owns it. Ordinary declarations
 * reference a variable and never a literal.
 *
 * That is not ceremony. A file whose colours are gathered into a palette block
 * can be read, retinted and reviewed in one place; a file with forty literals
 * scattered through four hundred lines cannot, which is how three games ended up
 * one digit apart from each other on every surface.
 *
 * Board and scene ART still gets a colour of its own — the wood of a checkers
 * board, the blue of a Connect Four grid, the ink of a chess square. It just has
 * to say its name out loud, and the budget below is what keeps "its own colour"
 * from quietly becoming "its own palette".
 */

const GAMES_ROOT = path.resolve(import.meta.dirname, '../..');

// Scoped to the GAMES and their platform. The kiosk's other rooms (producer,
// transport, the browse modes) answer to the same house style but are not this
// guard's business.
const GAME_DIRS = [
  'game-platform', 'PianoCardGame', 'PianoCheckers', 'PianoChessGame',
  'PianoConnectFour', 'PianoFlashcards', 'PianoHeroGame', 'PianoSpaceInvaders',
  'PianoTetris', 'SideScrollerGame',
];

/**
 * How many colours each file may NAME. A ratchet: these may fall without
 * discussion and may only rise with a reason written beside them.
 *
 * A file absent from this table may name none at all — it is furniture, and
 * furniture comes from the cabinet.
 */
const PALETTE_BUDGET = {
  // The cabinet itself. Every one of these aliases a house token (asserted below).
  'game-platform/chrome/gameChrome.scss': 12,
  // Board art: the surfaces a player looks AT rather than through.
  'PianoChessGame/PianoChessGame.scss': 4,
  'PianoChessGame/GestureCards.scss': 3,
  'PianoCheckers/PianoCheckers.scss': 13,
  'PianoConnectFour/PianoConnectFour.scss': 10,
  // Scene art: an arcade game's playfield and the colours its sprites are made of.
  'PianoTetris/PianoTetris.scss': 2,
  'PianoSpaceInvaders/SpaceInvadersGame.scss': 8,
  'PianoSpaceInvaders/components/SpaceInvadersOverlay.scss': 1,
  'SideScrollerGame/SideScrollerGame.scss': 4,
  'PianoFlashcards/PianoFlashcards.scss': 4,
  'PianoHeroGame/PianoHeroGame.scss': 10,
  // The office-screen launcher. It cannot draw from the cabinet: `--pg-*` is
  // declared on `.piano-game-host`/`.piano-game-fullscreen`, and the launcher
  // renders in the visualiser, outside both — and the cabinet is the kiosk's
  // dark palette, while this overlay dims the visualiser's own warm #d9d0c1
  // ground. Five names, one per material of the instrument it draws (case,
  // ivory, ebony, felt, brass); every tint and gradient stop in the file is a
  // color-mix of one of them, not a sixth colour.
  'game-platform/launcher/NoteLauncher.scss': 5,
};

function scssFiles(dir, out = [], base = dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) scssFiles(full, out, base);
    else if (name.endsWith('.scss')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Source with comments and `var(--x, #fallback)` arms removed.
 *
 * A fallback is the same token with a belt on, not a second palette — counting
 * it would push authors to DROP their fallbacks to satisfy the guard, which is
 * exactly backwards.
 */
function meaningful(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, 'var()');
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * A CHROMATIC `rgb()`/`rgba()` — one whose channels are not all equal.
 *
 * `rgba(0, 0, 0, .55)` and `rgba(255, 255, 255, .08)` are a shadow and a
 * highlight: neutrals with an alpha, legitimate anywhere, and not a palette.
 * `rgba(0, 200, 255, .4)` is a colour choice wearing a different syntax — and it
 * is where the second half of this problem was hiding. Every arcade game had its
 * neon twice: once as a hex the first version of this guard caught, and once as
 * an rgba glow it did not. `hsla(var(--hue), …)` is untouched, because a hue
 * driven by a variable is exactly the parameterisation this rule wants.
 */
const CHROMATIC = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi;

function chromaticFunctions(statement) {
  const found = [];
  for (const match of statement.matchAll(CHROMATIC)) {
    const channels = new Set(match.slice(1, 4));
    if (channels.size > 1) found.push(`${match[0]}…)`);
  }
  return found;
}

/** Statements, split so a custom-property declaration can be told from a normal one. */
function statements(source) {
  return meaningful(source).split(/[;{}]/);
}

/** Colour literals sitting in ORDINARY declarations — the thing that is banned. */
function looseLiterals(source) {
  return statements(source)
    .filter((statement) => !/--[\w-]+\s*:/.test(statement))
    .flatMap((statement) => [...(statement.match(HEX) ?? []), ...chromaticFunctions(statement)]);
}

/** Colours the file NAMES, in custom-property declarations — the thing budgeted. */
function namedColours(source) {
  return statements(source)
    .filter((statement) => /--[\w-]+\s*:/.test(statement)
      && ((statement.match(HEX) ?? []).length > 0 || chromaticFunctions(statement).length > 0))
    .map((statement) => statement.trim());
}

describe('game chrome tokens', () => {
  const files = scssFiles(GAMES_ROOT).filter((file) => GAME_DIRS.includes(file.split('/')[0]));

  it('finds the game stylesheets it is meant to be guarding', () => {
    // A rename that quietly emptied this list would turn the whole guard into a
    // pass, which is the one failure mode a ratchet like this has.
    expect(files.length).toBeGreaterThan(8);
    expect(files).toContain('PianoConnectFour/PianoConnectFour.scss');
    expect(files).toContain('game-platform/chrome/gameChrome.scss');
  });

  it.each(files)('%s puts every colour it names in a custom property', (file) => {
    const loose = looseLiterals(readFileSync(path.join(GAMES_ROOT, file), 'utf8'));
    expect(
      loose,
      `${file} writes ${loose.join(', ')} inline. Reference a --pg-/--piano- token (a tint of one is `
      + `color-mix(in srgb, var(--pg-brass) 40%, transparent)), or name it once in this file's palette `
      + 'block and use the variable.',
    ).toEqual([]);
  });

  it.each(files)('%s names no more colours than it is budgeted', (file) => {
    const named = namedColours(readFileSync(path.join(GAMES_ROOT, file), 'utf8'));
    const budget = PALETTE_BUDGET[file] ?? 0;
    expect(
      named.length,
      `${file} names ${named.length} colours (budget ${budget}):\n  ${named.join('\n  ')}`,
    ).toBeLessThanOrEqual(budget);
  });

  it('the token layer defines the cabinet, and defines each name once', () => {
    const source = readFileSync(path.join(GAMES_ROOT, 'game-platform/chrome/gameChrome.scss'), 'utf8');
    for (const token of ['--pg-case', '--pg-shelf', '--pg-hairline', '--pg-ivory', '--pg-brass', '--pg-felt', '--pg-tap']) {
      expect(source.match(new RegExp(`^\\s+${token}:`, 'gm')) ?? [], `${token} should be declared exactly once`).toHaveLength(1);
    }
  });

  it('every cabinet colour resolves to a house token, so the kiosk keeps one palette', () => {
    const source = readFileSync(path.join(GAMES_ROOT, 'game-platform/chrome/gameChrome.scss'), 'utf8');
    // Declarations only — `var(--pg-case)` USES the token and says nothing about
    // what it resolves to.
    const declarations = source.match(/^\s+--pg-(case|shelf|shelf-lift|hairline|ivory|ivory-dim|brass|brass-fill|brass-ink|felt):[^;]*;/gm) ?? [];
    expect(declarations.length).toBeGreaterThan(8);
    for (const declaration of declarations) {
      expect(declaration, `${declaration.trim()} should alias a --piano- token`).toMatch(/var\(--piano-/);
    }
  });
});
