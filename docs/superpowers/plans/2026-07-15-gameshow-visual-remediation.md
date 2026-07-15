# GameShow Visual Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GameShow's garish flat-blue palette and default-font typography with a tokenized studio-stage design system (dark indigo stage, gradient tile faces, warm brass accent, Anton display + Bitter serif type), and fix the board/clue layout so any board size fits the fixed 960×540 living-room frame.

**Architecture:** One SCSS tokens partial (`_tokens.scss`) owns every color, font, and type-size as CSS custom properties scoped to the module roots (`.gameshow` TV shell, `.gsh` mobile host), plus two button mixins. Every other stylesheet `@use`s it and contains zero hex literals. Fonts are self-hosted via `@fontsource` npm packages (kiosk CSP blocks external hosts). Two small JS changes carry the design system where CSS can't: a WCAG-luminance `onColor()` helper for text on team-colored surfaces, and character-count type buckets for clue prompts.

**Tech Stack:** SCSS (dart-sass modern-compiler via Vite), CSS custom properties + container queries (with fallbacks), `@fontsource/anton` + `@fontsource/bitter`, React 18, Vitest 4 + happy-dom + @testing-library/react.

**Source audit:** `docs/_wip/audits/2026-07-15-gameshow-ux-design-audit.md` — this plan covers findings §1.1, §1.2, §1.3, §1.4, §3.1–3.5, §4.1–4.5, plus the reduced-motion gap from §5.1. It deliberately does NOT cover input/flow blockers (§2.x — remote focus nav, DD wager no-op, escape interceptor) or audio/motion beats — those are separate plans.

## Global Constraints

- **Frame contract:** the TV UI renders in a fixed **960×540 CSS px** box (`ScreenRenderer.jsx:375-382`), root font-size **16px**, `overflow: hidden`. NO `vh`/`vw` units anywhere in TV-side SCSS (`GameShowHost.scss` is a real phone page and may keep `100vh`).
- **No external assets:** kiosk CSP blocks external hosts. Fonts must be npm-vendored (`@fontsource/*`), never Google Fonts URLs.
- **Zero hex literals** outside `styles/_tokens.scss` and `shell/teams/teamColors.js` when done (the two `teamColors.js` on-color constants intentionally duplicate two token values — CSS vars aren't readable from that pure JS helper).
- **Container-query CSS must carry a fallback declaration** on the preceding line (Shield WebView version is unverified).
- **Test command:** run from `/opt/Code/DaylightStation/frontend/` — `npx vitest run <path>`. Full module suite: `npx vitest run src/modules/GameShow`.
- **SCSS compile check:** `cd /opt/Code/DaylightStation/frontend && npx vite build` (Vitest stubs CSS, so only a build catches SCSS errors).
- **Commits:** conventional style `feat(gameshow): …`, each ending with the trailer line `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **This host is prod** (kckern-server). The final task deploys — it MUST run the deploy gates from `CLAUDE.local.md` (no redeploy during an active fitness session or live video playback) before `sudo deploy-daylight`.

## Design Decisions (locked — do not improvise)

| Token | Value | Role |
|---|---|---|
| `--gs-stage` | `#070b1e` | near-black indigo studio backdrop |
| `--gs-stage-glow` | `#101a56` | radial stage-light center for shell phases |
| `--gs-well` | `#04061a` | board well (gutters between tiles) |
| `--gs-tile-hi` / `--gs-tile-lo` | `#1b2fb0` / `#111d75` | tile face gradient (keeps the Jeopardy-blue identity, kills the neon `#060ce9`) |
| `--gs-tile-used` | `#0a1030` | used tiles go genuinely dark |
| `--gs-paper` / `--gs-paper-dim` | `#f3efe2` / `rgba(243,239,226,0.72)` | warm off-white text (replaces pure `#fff`) |
| `--gs-ink` | `#10131f` | dark text on light surfaces |
| `--gs-brass` / `--gs-brass-bright` | `#e8b54a` / `#f6d482` | warm metallic gold accent (replaces lemon `#ffd54a`) |
| `--gs-danger` | `#e05263` | wrong/error |
| `--gs-negative` | `#efa9b3` | negative scores (distinct from danger, audit §3.5) |
| `--gs-surface` / `--gs-surface-border` | `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.14)` | quiet buttons/cards |
| Display face | **Anton** (400) | title, dollar values, categories, scores, DD banner |
| Serif face | **Bitter** (500/700) | clue prompts, answers, subtitles |
| Type scale | `4.25rem / 2.75rem / 2rem / 1.35rem / 1.1rem` | display / feature / heading / label / caption |
| Team palette | `#3273dc #2fbf71 #9b5de5 #f28c28 #1fa8a0 #c2559f` | no gold (reserved for brass accent), no red (reserved for danger) |

## File Structure

- **Create** `frontend/src/modules/GameShow/styles/_tokens.scss` — all custom properties, `gs-pulse` keyframes (moved from Scoreboard.scss), reduced-motion guard, `gs-button`/`gs-button-primary` mixins.
- **Create** `frontend/src/modules/GameShow/styles/fonts.js` — side-effect `@fontsource` imports.
- **Create** `frontend/src/modules/GameShow/shell/teams/teamColors.js` (+ test) — `TEAM_COLORS`, `onColor(hex)`.
- **Create** `frontend/src/modules/GameShow/shell/components/RevealPanel.test.jsx` — type-bucket tests.
- **Modify** `GameShow.jsx`, `host/GameShowHost.jsx` (font import), `shell/teams/teamSetupReducer.js` (palette import), `shell/components/RevealPanel.jsx` (buckets), `games/Jeopardy/ClueScreen.jsx` (`--team-on`), `shell/timers/TimerRing.jsx` (tokenized strokes).
- **Rewrite** all five stylesheets: `GameShow.scss`, `games/Jeopardy/Jeopardy.scss`, `shell/components/components.scss`, `shell/scoreboard/Scoreboard.scss`, `shell/teams/TeamSetup.scss`, `host/GameShowHost.scss`.

---

### Task 1: Self-hosted display and serif faces

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Create: `frontend/src/modules/GameShow/styles/fonts.js`
- Modify: `frontend/src/modules/GameShow/GameShow.jsx:13` (add import)
- Modify: `frontend/src/modules/GameShow/host/GameShowHost.jsx:11` (add import)

**Interfaces:**
- Produces: font families `'Anton'` (weight 400) and `'Bitter'` (weights 500, 700) available to any CSS in the app once either GameShow entry loads. Later tasks reference them only through `--gs-font-display` / `--gs-font-serif` tokens (Task 2).

- [ ] **Step 1: Install the font packages**

```bash
cd /opt/Code/DaylightStation/frontend && npm install @fontsource/anton @fontsource/bitter
```

Expected: both packages appear in `frontend/package.json` dependencies; `ls node_modules/@fontsource/anton/index.css node_modules/@fontsource/bitter/500.css node_modules/@fontsource/bitter/700.css` lists all three files.

- [ ] **Step 2: Create the side-effect import module**

Create `frontend/src/modules/GameShow/styles/fonts.js`:

```js
// Self-hosted faces — the kiosk CSP blocks external font hosts, so these
// ship in the bundle via @fontsource (woff2 + @font-face, no network).
// Anton  — display: title cards, dollar values, categories, scores.
// Bitter — serif: clue prompts and answers.
import '@fontsource/anton';
import '@fontsource/bitter/500.css';
import '@fontsource/bitter/700.css';
```

- [ ] **Step 3: Import it from both entry components**

In `frontend/src/modules/GameShow/GameShow.jsx`, add after the existing `import './GameShow.scss';` line:

```js
import './styles/fonts.js';
```

In `frontend/src/modules/GameShow/host/GameShowHost.jsx`, add after the existing `import './GameShowHost.scss';` line:

```js
import '../styles/fonts.js';
```

- [ ] **Step 4: Verify the module suite still passes and the build resolves the imports**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
```

Expected: all existing GameShow tests PASS; `vite build` completes with no "Could not resolve" errors and the output lists `anton`/`bitter` woff2 assets.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/package.json frontend/package-lock.json frontend/src/modules/GameShow/styles/fonts.js frontend/src/modules/GameShow/GameShow.jsx frontend/src/modules/GameShow/host/GameShowHost.jsx
git commit -m "feat(gameshow): self-host Anton + Bitter faces via fontsource

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Design tokens partial

**Files:**
- Create: `frontend/src/modules/GameShow/styles/_tokens.scss`
- Modify: `frontend/src/modules/GameShow/GameShow.scss:1` (add `@use`; full rewrite comes in Task 6)

**Interfaces:**
- Produces: CSS custom properties (table in Design Decisions above) scoped under `.gameshow, .gsh`; global keyframes `gs-pulse`; SCSS mixins `gs.gs-button` and `gs.gs-button-primary` for any stylesheet that does `@use '<relative>/styles/tokens' as gs;`. Every later task consumes exactly these names.

- [ ] **Step 1: Create the tokens partial**

Create `frontend/src/modules/GameShow/styles/_tokens.scss`:

```scss
// GameShow design system. Every color, face, and type size in the module
// lives here as a custom property scoped to the two module roots
// (.gameshow = TV shell, .gsh = mobile host companion) so nothing leaks
// app-wide. No other GameShow stylesheet may declare a hex literal.
.gameshow,
.gsh {
  // stage
  --gs-stage: #070b1e;
  --gs-stage-glow: #101a56;
  --gs-well: #04061a;
  --gs-surface: rgba(255, 255, 255, 0.08);
  --gs-surface-border: rgba(255, 255, 255, 0.14);

  // board
  --gs-tile-hi: #1b2fb0;
  --gs-tile-lo: #111d75;
  --gs-tile-used: #0a1030;

  // ink
  --gs-paper: #f3efe2;
  --gs-paper-dim: rgba(243, 239, 226, 0.72);
  --gs-ink: #10131f;

  // accents
  --gs-brass: #e8b54a;
  --gs-brass-bright: #f6d482;
  --gs-danger: #e05263;
  --gs-negative: #efa9b3;

  // type
  --gs-font-display: 'Anton', 'Arial Narrow', sans-serif;
  --gs-font-serif: 'Bitter', georgia, serif;
  --gs-font-ui: system-ui, sans-serif;
  --gs-fs-display: 4.25rem;
  --gs-fs-feature: 2.75rem;
  --gs-fs-heading: 2rem;
  --gs-fs-label: 1.35rem;
  --gs-fs-caption: 1.1rem;
  --gs-shadow-text: 0 2px 0 rgba(0, 0, 0, 0.4);
}

@keyframes gs-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--team-color, var(--gs-brass)); }
  50% { box-shadow: 0 0 1.2rem 0.2rem var(--team-color, var(--gs-brass)); }
}

@media (prefers-reduced-motion: reduce) {
  .gameshow *,
  .gsh * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}

@mixin gs-button {
  font-family: var(--gs-font-ui);
  font-size: var(--gs-fs-label);
  font-weight: 600;
  color: var(--gs-paper);
  background: var(--gs-surface);
  border: 1px solid var(--gs-surface-border);
  border-radius: 0.5rem;
  padding: 0.7rem 1.75rem;
  cursor: pointer;

  &:focus { outline: 3px solid var(--gs-brass-bright); outline-offset: 2px; }
  &:disabled { opacity: 0.4; cursor: default; }
}

@mixin gs-button-primary {
  @include gs-button;
  background: linear-gradient(180deg, var(--gs-brass-bright), var(--gs-brass));
  border-color: transparent;
  color: var(--gs-ink);
  font-weight: 700;

  &:focus { outline: 3px solid var(--gs-paper); }
}
```

- [ ] **Step 2: Wire it into the shell stylesheet**

In `frontend/src/modules/GameShow/GameShow.scss`, add as the very first line (before `.gameshow {`):

```scss
@use './styles/tokens' as gs;
```

(The rest of `GameShow.scss` is rewritten in Task 6; this just proves the partial compiles from a consumer.)

- [ ] **Step 3: Verify SCSS compiles and tests pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
```

Expected: tests PASS; build completes with no sass errors.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/GameShow/styles/_tokens.scss frontend/src/modules/GameShow/GameShow.scss
git commit -m "feat(gameshow): add design-token partial (stage palette, brass accent, type scale, button mixins)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Team palette + `onColor()` contrast helper (TDD)

**Files:**
- Create: `frontend/src/modules/GameShow/shell/teams/teamColors.js`
- Create: `frontend/src/modules/GameShow/shell/teams/teamColors.test.js`
- Modify: `frontend/src/modules/GameShow/shell/teams/teamSetupReducer.js:4` (replace `COLORS`)
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx:42` (pass `--team-on`)

**Interfaces:**
- Produces: `TEAM_COLORS: string[]` (6 hex strings) and `onColor(hex: string) => string` (returns `'#f3efe2'` paper or `'#10131f'` ink) from `shell/teams/teamColors.js`. Later tasks' CSS reads `var(--team-on, var(--gs-paper))` on any element that also gets `--team-color` as a background.
- Consumes: nothing from other tasks (pure JS; independent of Tasks 1–2).

**Why:** audit §3.2 — white text on light team colors (gold/green/orange) fails contrast at the buzz-in banner, the single highest-stakes readout in the game. §3.3 — team-1 gold collides with the UI accent. Presets in the data volume carry arbitrary hex (including legacy gold), so the on-color must be *computed*, not looked up.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/GameShow/shell/teams/teamColors.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { TEAM_COLORS, onColor } from './teamColors.js';

describe('teamColors', () => {
  it('palette has six colors and reserves gold for the UI accent', () => {
    expect(TEAM_COLORS).toHaveLength(6);
    expect(TEAM_COLORS).not.toContain('#e6b325'); // old team-1 gold collided with the brass accent
  });

  it('dark team colors get paper text', () => {
    expect(onColor('#3273dc')).toBe('#f3efe2');
    expect(onColor('#9b5de5')).toBe('#f3efe2');
    expect(onColor('#c2559f')).toBe('#f3efe2');
  });

  it('light team colors get dark ink', () => {
    expect(onColor('#2fbf71')).toBe('#10131f');
    expect(onColor('#f28c28')).toBe('#10131f');
    expect(onColor('#e6b325')).toBe('#10131f'); // legacy preset gold still in data-volume presets
  });

  it('garbage input falls back to paper', () => {
    expect(onColor(undefined)).toBe('#f3efe2');
    expect(onColor('blue')).toBe('#f3efe2');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow/shell/teams/teamColors.test.js
```

Expected: FAIL — `Cannot find module './teamColors.js'` (or equivalent resolve error).

- [ ] **Step 3: Implement**

Create `frontend/src/modules/GameShow/shell/teams/teamColors.js`:

```js
// Team palette + readable on-color. Gold is deliberately absent (reserved
// for the UI brass accent) and so is red (reserved for danger/negative).
// Presets from the data volume can carry ANY hex, so text-on-team-color is
// computed from WCAG relative luminance, not looked up.

export const TEAM_COLORS = ['#3273dc', '#2fbf71', '#9b5de5', '#f28c28', '#1fa8a0', '#c2559f'];

// Intentional duplicates of --gs-paper / --gs-ink (CSS vars aren't readable
// from this pure helper; keep in sync with styles/_tokens.scss).
const PAPER = '#f3efe2';
const INK = '#10131f';

function linear(hex, i) {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function onColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return PAPER;
  const L = 0.2126 * linear(hex, 0) + 0.7152 * linear(hex, 1) + 0.0722 * linear(hex, 2);
  return L > 0.3 ? INK : PAPER;
}
```

- [ ] **Step 4: Run the new test — expect PASS**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow/shell/teams/teamColors.test.js
```

Expected: 4 tests PASS.

- [ ] **Step 5: Swap the reducer's palette**

In `frontend/src/modules/GameShow/shell/teams/teamSetupReducer.js`, replace the line

```js
const COLORS = ['#e6b325', '#3273dc', '#2fbf71', '#e05263', '#9b5de5', '#f28c28'];
```

with

```js
import { TEAM_COLORS as COLORS } from './teamColors.js';
```

and move that import to the top of the file (above the `reslot` function, keeping the existing file comment first). No other changes — `COLORS[i % COLORS.length]` call sites stay as-is.

- [ ] **Step 6: Wire `--team-on` into the buzz-in banner**

In `frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx`, add to the imports:

```js
import { onColor } from '../../shell/teams/teamColors.js';
```

and change the locked-team div (currently `style={{ '--team-color': lockedTeam.color }}`) to:

```jsx
<div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color, '--team-on': onColor(lockedTeam.color) }}>
  {lockedTeam.name} buzzed in!
</div>
```

(The CSS that consumes `--team-on` lands in Task 5; until then the extra property is inert.)

- [ ] **Step 7: Run the full module suite**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow
```

Expected: ALL tests PASS (existing `teamSetupReducer.test.js` asserts ids/slots/members, not hex values, so the reorder is safe — if a color assertion fails, that's a real regression to investigate, not to paper over).

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/GameShow/shell/teams/teamColors.js frontend/src/modules/GameShow/shell/teams/teamColors.test.js frontend/src/modules/GameShow/shell/teams/teamSetupReducer.js frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx
git commit -m "feat(gameshow): computed on-colors + de-collided team palette

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Board — fit the 16:9 frame and restyle the tiles

**Files:**
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss:1-22` (the `.jp-board` block + add `@use`)

**Interfaces:**
- Consumes: tokens + mixins from Task 2 (`@use '../../styles/tokens' as gs;`).
- Produces: nothing new for later tasks; `Board.jsx` already sets `--cats` and `--rows` inline (`Board.jsx:8`) — this task finally consumes `--rows`.

**Why:** audit §1.1 — tiles have `min-height: 5.5rem` and the grid never declares rows, so a classic 5-row board needs ~579px of a ~384px slot and the scoreboard gets clipped off-frame; small boards leave dead space. §3.1 — tile `#0a1bb0` on backdrop `#060ce9` is ~1.1:1, the grid has no edge definition. §4.1/4.4 — default font + hard-offset shadow.

- [ ] **Step 1: Add the tokens import**

At the very top of `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss`, add:

```scss
@use '../../styles/tokens' as gs;
```

- [ ] **Step 2: Replace the `.jp-board { … }` block**

Replace the entire existing `.jp-board` block (lines 1–22 of the original file: the grid declaration, `&__cat`, and `&__tile`) with:

```scss
.jp-board {
  flex: 1;
  min-height: 0; // let the grid track the flex slot instead of its content
  display: grid;
  grid-template-columns: repeat(var(--cats), minmax(0, 1fr));
  // Header row + one fr row per clue row: any board size (3-row sample or
  // 6-row classic) divides the same fixed 960x540 frame. --rows comes from
  // Board.jsx inline style.
  grid-template-rows: minmax(2.4rem, auto) repeat(var(--rows), minmax(0, 1fr));
  gap: 0.4rem;
  padding: 1rem;
  background: var(--gs-well);
  container-type: size;

  &__cat {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: hidden;
    padding: 0.25rem 0.5rem;
    font-family: var(--gs-font-display);
    font-size: 1.1rem; // fallback: no container-query support
    font-size: clamp(0.9rem, 3.4cqh, 1.3rem);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--gs-paper);
  }

  &__tile {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    overflow: hidden;
    background: linear-gradient(180deg, var(--gs-tile-hi) 0%, var(--gs-tile-lo) 100%);
    border-radius: 0.3rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -2px 6px rgba(0, 0, 0, 0.35);
    font-family: var(--gs-font-display);
    font-size: 1.6rem; // fallback: no container-query support
    font-size: min(2.4rem, calc(34cqh / var(--rows))); // row-aware: big on 3-row boards, fits 6-row
    letter-spacing: 0.03em;
    color: var(--gs-brass);
    text-shadow: var(--gs-shadow-text);

    &.is-used {
      background: var(--gs-tile-used);
      box-shadow: none;
    }
    &.is-cursor {
      outline: 0.25rem solid var(--gs-brass-bright);
      outline-offset: -0.25rem; // inside the tile so edge tiles don't clip against the frame
      z-index: 1;
    }
  }
}
```

Leave the rest of the file (`.jp-clue`, `.jp-final`, `.jp-results`) untouched — Tasks 5 and 6 rewrite those.

- [ ] **Step 3: Verify compile + tests**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
```

Expected: all PASS, build clean.

- [ ] **Step 4: Visual spot-check the fit math (no browser needed)**

Sanity-check by arithmetic in the commit message or your notes: frame 540px − scoreboard ≈108px = 432px board slot; grid rows are `auto + N × 1fr` so N=3 and N=6 both fit by construction; tile font at N=5 ≈ `min(38.4px, 34% × 432px ÷ 5) ≈ 29px`. If any number disagrees with what you implemented, stop and re-read Step 2.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss
git commit -m "feat(gameshow): board fits any row count in the 960x540 frame; gradient tile faces on dark well

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Clue screen — length-responsive serif type (TDD) + restyle

**Files:**
- Create: `frontend/src/modules/GameShow/shell/components/RevealPanel.test.jsx`
- Modify: `frontend/src/modules/GameShow/shell/components/RevealPanel.jsx`
- Modify: `frontend/src/modules/GameShow/shell/components/components.scss` (`.gs-reveal` + `.gs-media` blocks only; add `@use`)
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss` (`.jp-clue` block only)
- Modify: `frontend/src/modules/GameShow/shell/timers/TimerRing.jsx:9-12` (tokenized strokes)

**Interfaces:**
- Consumes: tokens/mixins (Task 2); `--team-on` set by ClueScreen (Task 3).
- Produces: `gs-reveal__prompt--lg|md|sm` modifier classes (CSS + JSX must agree on these exact names).

**Why:** audit §1.2/§4.3 — fixed 3.2rem clue type wraps long prompts past the frame; §1.3 — `50vh` media cap measures the real viewport, not the frame; §3.2 — buzz-in banner contrast; §4.1 — clue prose should be the serif face.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/GameShow/shell/components/RevealPanel.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RevealPanel from './RevealPanel.jsx';

describe('RevealPanel type buckets', () => {
  it('short prompts get the large bucket', () => {
    render(<RevealPanel prompt="Short clue" />);
    expect(screen.getByText('Short clue').className).toContain('gs-reveal__prompt--lg');
  });

  it('mid-length prompts step down to medium', () => {
    const prompt = 'x'.repeat(150);
    render(<RevealPanel prompt={prompt} />);
    expect(screen.getByText(prompt).className).toContain('gs-reveal__prompt--md');
  });

  it('long prompts get the small bucket', () => {
    const prompt = 'x'.repeat(240);
    render(<RevealPanel prompt={prompt} />);
    expect(screen.getByText(prompt).className).toContain('gs-reveal__prompt--sm');
  });

  it('answer renders only when revealed', () => {
    const { rerender } = render(<RevealPanel prompt="Q" answer="A" />);
    expect(screen.queryByText('A')).toBeNull();
    rerender(<RevealPanel prompt="Q" revealed answer="A" />);
    expect(screen.getByText('A')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow/shell/components/RevealPanel.test.jsx
```

Expected: FAIL — the three bucket tests fail (`className` lacks the modifier); the reveal test passes (existing behavior).

- [ ] **Step 3: Implement the buckets**

Replace the full contents of `frontend/src/modules/GameShow/shell/components/RevealPanel.jsx` with:

```jsx
import React from 'react';
import './components.scss';

// Clues range from one-liners to paragraph length; bucket the type size by
// character count so long prompts still fit the fixed 960x540 frame.
function promptSize(prompt) {
  const len = (prompt || '').length;
  if (len > 200) return 'sm';
  if (len > 120) return 'md';
  return 'lg';
}

export function RevealPanel({ prompt, revealed = false, answer = null }) {
  return (
    <div className="gs-reveal" data-testid="reveal-panel">
      <div className={`gs-reveal__prompt gs-reveal__prompt--${promptSize(prompt)}`}>{prompt}</div>
      {revealed && answer && <div className="gs-reveal__answer">{answer}</div>}
    </div>
  );
}
export default RevealPanel;
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow/shell/components/RevealPanel.test.jsx
```

Expected: 4 tests PASS.

- [ ] **Step 5: Restyle `.gs-reveal` and `.gs-media`**

In `frontend/src/modules/GameShow/shell/components/components.scss`: add as the very first line

```scss
@use '../../styles/tokens' as gs;
```

then replace the existing `.gs-reveal { … }` and `.gs-media { … }` blocks with:

```scss
.gs-reveal {
  flex: 1 1 auto;
  min-height: 0; // share the clue column with banner/media/legend instead of claiming 100%
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 0 2rem;
  text-align: center;

  &__prompt {
    font-family: var(--gs-font-serif);
    font-weight: 500;
    line-height: 1.3;
    color: var(--gs-paper);
    text-wrap: balance;

    &--lg { font-size: var(--gs-fs-feature); }
    &--md { font-size: 2.2rem; }
    &--sm { font-size: 1.8rem; }
  }

  &__answer {
    font-family: var(--gs-font-serif);
    font-weight: 700;
    font-size: var(--gs-fs-heading);
    color: var(--gs-brass);
    border-top: 2px solid var(--gs-surface-border);
    padding-top: 1.25rem;
  }
}

.gs-media {
  &--image,
  &--video {
    max-width: 70%;
    max-height: 45%; // % of the definite-height clue column — NEVER vh (frame contract)
    min-height: 0;
    flex: 0 1 auto;
    border-radius: 0.4rem;
    object-fit: contain;
  }
}
```

Leave `.gs-titlecard`, `.gs-wager`, `.gs-legend` untouched — Task 6 rewrites them.

- [ ] **Step 6: Restyle `.jp-clue`**

In `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss` (which already has the `@use` from Task 4), replace the existing `.jp-clue { … }` block with:

```scss
.jp-clue {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 2rem;

  &__banner {
    flex: 0 0 auto;
    display: flex;
    gap: 1.5rem;
    align-items: center;
    font-family: var(--gs-font-display);
    font-size: var(--gs-fs-heading);
    letter-spacing: 0.04em;
  }
  &__dd {
    color: var(--gs-brass-bright);
    letter-spacing: 0.18em;
    animation: gs-pulse 1.2s infinite;
  }
  &__value {
    color: var(--gs-brass);
    text-shadow: var(--gs-shadow-text);
  }
  &__locked {
    flex: 0 0 auto;
    font-family: var(--gs-font-display);
    font-size: var(--gs-fs-heading);
    letter-spacing: 0.03em;
    padding: 0.6rem 2rem;
    border-radius: 0.75rem;
    background: var(--team-color);
    color: var(--team-on, var(--gs-paper)); // computed contrast from Task 3
    animation: gs-pulse 0.9s infinite;
  }
  &__media-error {
    color: var(--gs-paper-dim);
    font-style: italic;
  }
}
```

- [ ] **Step 7: Tokenize the timer ring strokes**

In `frontend/src/modules/GameShow/shell/timers/TimerRing.jsx`, replace the two `<circle>` stroke values:

```jsx
<circle cx="50" cy="50" r={R} fill="none" stroke="var(--gs-surface-border)" strokeWidth="8" />
<circle
  cx="50" cy="50" r={R} fill="none"
  stroke={progress < 0.25 ? 'var(--gs-danger)' : 'var(--gs-brass)'} strokeWidth="8" strokeLinecap="round"
  strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
  transform="rotate(-90 50 50)"
/>
```

(SVG `stroke` accepts CSS custom properties; the ring always renders inside `.gameshow` where they're defined.)

- [ ] **Step 8: Full module suite + build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
```

Expected: all PASS (including the ClueScreen-related integration test), build clean.

- [ ] **Step 9: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/GameShow/shell/components/RevealPanel.jsx frontend/src/modules/GameShow/shell/components/RevealPanel.test.jsx frontend/src/modules/GameShow/shell/components/components.scss frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss frontend/src/modules/GameShow/shell/timers/TimerRing.jsx
git commit -m "feat(gameshow): serif clue type with length buckets; frame-safe media caps; contrast-safe buzz banner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Remaining TV surfaces — shell chrome, title/wager/legend, scoreboard, team setup, final/results

**Files:**
- Modify: `frontend/src/modules/GameShow/GameShow.scss` (full rewrite)
- Modify: `frontend/src/modules/GameShow/shell/components/components.scss` (`.gs-titlecard`, `.gs-wager`, `.gs-legend` blocks)
- Modify: `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss` (full rewrite; keyframes move out)
- Modify: `frontend/src/modules/GameShow/shell/teams/TeamSetup.scss` (full rewrite)
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss` (`.jp-final`, `.jp-results` blocks)

**Interfaces:**
- Consumes: tokens/mixins (Task 2). `Jeopardy.scss` and `components.scss` already carry their `@use` lines from Tasks 4–5; `Scoreboard.scss` and `TeamSetup.scss` get theirs here.
- Produces: final stylesheet state — after this task, `grep -rn '#[0-9a-fA-F]\{3,6\}' frontend/src/modules/GameShow --include='*.scss'` must only hit `styles/_tokens.scss`.

- [ ] **Step 1: Rewrite `GameShow.scss`**

Replace the full contents of `frontend/src/modules/GameShow/GameShow.scss` with:

```scss
@use './styles/tokens' as gs;

.gameshow {
  width: 100%;
  height: 100%;
  position: relative; // own the absolutely-positioned chrome (QR card, WS badge)
  background: radial-gradient(ellipse at 50% 30%, var(--gs-stage-glow) 0%, var(--gs-stage) 70%);
  color: var(--gs-paper);
  font-family: var(--gs-font-ui);
  display: flex;
  flex-direction: column;

  // direct-mounted title cards (loading / set-loading) fill the stage
  > .gs-titlecard { flex: 1; }

  &__error {
    color: var(--gs-danger);
    font-family: var(--gs-font-serif);
    font-size: var(--gs-fs-label);
    padding: 1rem;
    text-align: center;
  }
  &__ws-warn {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    opacity: 0.6;
    font-size: 1.2rem;
  }
  &__hostqr {
    position: absolute;
    bottom: 0.75rem;
    right: 0.75rem;
    text-align: center;
    background: var(--gs-paper);
    border-radius: 0.4rem;
    padding: 0.3rem;
    opacity: 0.85;

    img { display: block; }
    span {
      display: block;
      color: var(--gs-ink);
      font-size: 0.75rem;
      font-weight: 700;
    }
  }
  &__resume,
  &__sets,
  &__bind {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;

    button {
      @include gs.gs-button;
      &.is-binding { animation: gs-pulse 0.9s infinite; }
    }
  }
}

.jeopardy {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

Note the old `.jeopardy button { … }` blanket rule is GONE — buttons inside the game are styled where they live (`.jp-final` below) so component button styles never fight it on specificity.

- [ ] **Step 2: Rewrite `.gs-titlecard`, `.gs-wager`, `.gs-legend` in `components.scss`**

Replace those three blocks (keep the Task-5 `.gs-reveal`/`.gs-media` blocks and the `@use` line) with:

```scss
.gs-titlecard {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;

  h1 {
    margin: 0;
    font-family: var(--gs-font-display);
    font-size: var(--gs-fs-display);
    line-height: 1.05;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gs-paper);
    text-shadow: var(--gs-shadow-text);
  }
  p {
    margin: 0;
    font-family: var(--gs-font-serif);
    font-size: var(--gs-fs-label);
    color: var(--gs-paper-dim);
  }
}

.gs-wager {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  align-items: center;
  justify-content: center;

  &__team {
    font-family: var(--gs-font-serif);
    font-weight: 700;
    font-size: var(--gs-fs-heading);
  }
  &__row {
    display: flex;
    gap: 1.5rem;
    align-items: center;

    button { @include gs.gs-button; }
  }
  &__amount {
    font-family: var(--gs-font-display);
    font-size: 3rem;
    letter-spacing: 0.03em;
    min-width: 10rem;
    text-align: center;
    color: var(--gs-brass);
    text-shadow: var(--gs-shadow-text);
  }
  &__confirm { @include gs.gs-button-primary; }
}

.gs-legend {
  flex: 0 0 auto;
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  padding: 0.6rem;
  font-family: var(--gs-font-ui);
  font-size: var(--gs-fs-caption); // was 1rem @ 0.7 opacity — below the 10-foot floor
  color: var(--gs-paper-dim);

  kbd {
    background: var(--gs-surface);
    border: 1px solid var(--gs-surface-border);
    border-radius: 0.25rem;
    padding: 0.1rem 0.5rem;
    margin-right: 0.3rem;
    color: var(--gs-paper);
  }
}
```

- [ ] **Step 3: Rewrite `Scoreboard.scss`**

Replace the full contents of `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss` with (note: NO keyframes here anymore — `gs-pulse` lives in the tokens partial):

```scss
@use '../../styles/tokens' as gs;

.gs-scoreboard {
  flex: 0 0 auto;
  display: flex;
  gap: 1rem;
  justify-content: center;
  padding: 0.6rem 1rem;

  &__team {
    min-width: 11rem;
    padding: 0.4rem 1.25rem;
    border-radius: 0.5rem;
    border-top: 0.3rem solid var(--team-color);
    background: rgba(0, 0, 0, 0.45);
    text-align: center;

    &.is-active { outline: 2px solid var(--gs-brass-bright); }
    &.is-locked { animation: gs-pulse 0.9s ease-in-out infinite; }
  }
  &__name {
    display: block;
    font-family: var(--gs-font-ui);
    font-size: 1rem;
    color: var(--gs-paper-dim);
  }
  &__score {
    display: block;
    font-family: var(--gs-font-display);
    font-size: var(--gs-fs-heading);
    letter-spacing: 0.03em;
    color: var(--gs-paper);
    text-shadow: var(--gs-shadow-text);

    &.is-negative { color: var(--gs-negative); } // distinct from danger red (audit §3.5)
  }
}
```

- [ ] **Step 4: Rewrite `TeamSetup.scss`**

Replace the full contents of `frontend/src/modules/GameShow/shell/teams/TeamSetup.scss` with:

```scss
@use '../../styles/tokens' as gs;

.gs-teamsetup {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;

  &__presets {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  &__teams {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 1rem;
    justify-content: center;
    overflow: hidden;
  }
  &__team {
    flex: 0 1 16rem; // shrinkable — 4+ teams compress instead of overflowing the frame
    min-width: 0;
    padding: 1rem;
    border-radius: 0.75rem;
    border-top: 0.4rem solid var(--team-color);
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
  }
  &__teamname {
    font-family: var(--gs-font-display);
    font-size: var(--gs-fs-label);
    letter-spacing: 0.04em;
  }
  &__add { @include gs.gs-button; }
  &__confirm {
    @include gs.gs-button-primary;
    align-self: center;
  }
}

.gs-chip {
  font-family: var(--gs-font-ui);
  font-size: 1rem;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--gs-surface);
  color: var(--gs-paper);
  cursor: pointer;

  &:focus { outline: 3px solid var(--gs-brass-bright); }
  &.is-active {
    background: var(--gs-brass);
    color: var(--gs-ink);
    font-weight: 700;
  }
  &--pool {
    background: transparent;
    border-color: var(--gs-surface-border);
    color: var(--gs-paper-dim);
  }
  &--danger { background: rgba(224, 82, 99, 0.35); }
}
```

- [ ] **Step 5: Rewrite `.jp-final` and `.jp-results` in `Jeopardy.scss`**

Replace those two blocks (keep the Task-4 `.jp-board` and Task-5 `.jp-clue` blocks and the `@use` line) with:

```scss
.jp-final {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;

  > button { @include gs.gs-button-primary; } // Start / Continue

  &__locked {
    color: var(--gs-paper-dim);
    font-size: var(--gs-fs-caption);
  }
  &__judging {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  &__team {
    display: flex;
    gap: 1rem;
    align-items: center;
    font-family: var(--gs-font-serif);
    font-size: var(--gs-fs-label);

    button { @include gs.gs-button; }
  }
}

.jp-results {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;

  &__list {
    font-family: var(--gs-font-serif);
    font-size: 1.8rem;

    li {
      margin: 0.4rem 0;
      border-left: 0.4rem solid var(--team-color);
      padding-left: 0.75rem;
    }
  }
  &__actions {
    display: flex;
    gap: 1rem;

    button { @include gs.gs-button-primary; }
  }
}
```

**Specificity note (why this is safe):** the round-intro "Start" button is a direct child of `.jp-final` (`Jeopardy.jsx:151-154`), so `> button` styles it; final-judging Correct/Wrong buttons match `.jp-final__team button`. Nothing else in the game renders bare buttons, so removing the old `.jeopardy button` blanket in Step 1 leaves no orphan.

- [ ] **Step 6: Verify — tests, build, and the zero-hex sweep**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
grep -rn '#[0-9a-fA-F]\{3,6\}' src/modules/GameShow --include='*.scss' | grep -v styles/_tokens.scss
```

Expected: tests PASS, build clean, and the grep prints **nothing** (all hex now lives in the tokens partial).

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/GameShow/GameShow.scss frontend/src/modules/GameShow/shell/components/components.scss frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss frontend/src/modules/GameShow/shell/teams/TeamSetup.scss frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss
git commit -m "feat(gameshow): tokenize all TV surfaces — stage gradient, Anton/Bitter type, brass buttons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Host companion reskin

**Files:**
- Modify: `frontend/src/modules/GameShow/host/GameShowHost.scss` (full rewrite)

**Interfaces:**
- Consumes: tokens (Task 2) — the `.gsh` root is already in the tokens scope selector, and `GameShowHost.jsx` already imports the fonts (Task 1).

**Why:** the phone must read as the same product as the TV. This is a real phone page, so `100vh` is correct here (the frame contract applies to the TV side only).

- [ ] **Step 1: Rewrite `GameShowHost.scss`**

Replace the full contents with:

```scss
@use '../styles/tokens' as gs;

.gsh {
  min-height: 100vh; // real phone page — vh is correct here, unlike the TV frame
  background: var(--gs-stage);
  color: var(--gs-paper);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  font-family: var(--gs-font-ui);
  -webkit-tap-highlight-color: transparent;

  &--loading,
  &--error {
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
  }
  &--error { color: var(--gs-danger); }

  &__scores {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  &__score {
    flex: 1 1 40%;
    padding: 0.4rem 0.75rem;
    border-radius: 0.4rem;
    background: rgba(0, 0, 0, 0.4);
    border-left: 0.3rem solid var(--team-color);
    font-size: 0.95rem;

    b {
      display: block;
      color: var(--gs-paper-dim);
      font-size: 0.8rem;
    }
  }

  &__phase {
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--gs-paper-dim);
    font-size: 0.85rem;
  }

  &__board {
    display: grid;
    grid-template-columns: repeat(var(--cats), 1fr);
    gap: 0.35rem;
  }
  &__col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  &__cat {
    min-height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
    text-transform: uppercase;
    font-family: var(--gs-font-display);
    font-size: 0.7rem;
    letter-spacing: 0.03em;
  }
  &__tile {
    background: linear-gradient(180deg, var(--gs-tile-hi), var(--gs-tile-lo));
    color: var(--gs-brass);
    border: none;
    border-radius: 0.3rem;
    font-family: var(--gs-font-display);
    font-size: 1.05rem;
    letter-spacing: 0.03em;
    padding: 0.9rem 0;
    cursor: pointer;

    &.is-used {
      background: var(--gs-tile-used);
      color: transparent;
    }
  }

  &__clue {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  &__cluetext {
    font-family: var(--gs-font-serif);
    font-weight: 500;
    font-size: 1.3rem;
  }
  &__answer {
    color: var(--gs-brass);
    font-size: 1.1rem;
  }

  &__row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  &__wager {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }
  &__wagerlabel {
    font-size: 1.1rem;
    font-weight: 700;
  }
  &__wageramt {
    font-family: var(--gs-font-display);
    font-size: 1.8rem;
    letter-spacing: 0.03em;
    color: var(--gs-brass);
    min-width: 6rem;
    text-align: center;
  }

  &__finaljudge {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  &__done {
    font-size: 1.5rem;
    text-align: center;
  }

  &__actions {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    position: sticky;
    bottom: 0.5rem;
  }
}

.gsh-btn {
  border: none;
  border-radius: 0.5rem;
  padding: 1rem;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  color: var(--gs-paper);
  background: var(--gs-surface);

  &--primary {
    background: linear-gradient(180deg, var(--gs-brass-bright), var(--gs-brass));
    color: var(--gs-ink);
  }
  &--danger { background: var(--gs-danger); }
  &--team {
    background: var(--gs-tile-hi);
    flex: 1;
  }

  &:active { transform: scale(0.97); }
}
```

(Design note baked in: host primary buttons go brass-on-ink to match the TV's confirm buttons, and "team answers" buttons reuse the tile indigo — the old flat green/blue read as a different app.)

- [ ] **Step 2: Verify — tests, build, zero-hex sweep now covers the host too**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
grep -rn '#[0-9a-fA-F]\{3,6\}' src/modules/GameShow --include='*.scss' | grep -v styles/_tokens.scss
```

Expected: tests PASS, build clean, grep prints nothing.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/GameShow/host/GameShowHost.scss
git commit -m "feat(gameshow): host companion matches the TV design system

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full verification, deploy, and on-TV visual check

**Files:** none created — verification + deploy only.

**Interfaces:**
- Consumes: everything above, committed.

- [ ] **Step 1: Full module suite + production build one last time**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
```

Expected: all tests PASS; build clean.

- [ ] **Step 2: Desktop visual check at frame size (before touching prod)**

Start the dev server (`cd /opt/Code/DaylightStation && npm run dev` or the project's usual dev command), open `http://localhost:<vite-port>/app/gameshow` in a browser with the viewport forced to exactly **960×540** (devtools responsive mode). Walk: set-picker → team setup → bind → round intro → board → a clue → reveal. Confirm, by eye:
1. Board: dark well, gradient tiles, brass Anton values, no clipped scoreboard.
2. Clue: Bitter serif prompt, banner + timer + legend all visible with a long (>200 char) prompt if the sample set has one.
3. No element extends past the 960×540 viewport (no scrollbars, nothing cut off).
4. Buzz-in banner text is readable on a light team color (assign the green or orange team and buzz with keyboard digit `2`).

If anything is broken, fix it in the offending task's file and amend/commit before deploying.

- [ ] **Step 3: Deploy gates (this host is prod — mandatory)**

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```

Expected for "clear to deploy": first command prints `0`; second shows no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. **If either gate is active, WAIT — do not deploy over a workout or live video.**

- [ ] **Step 4: Build the image and deploy**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Expected: build succeeds; container comes back up (`sudo docker ps` shows `daylight-station` running).

- [ ] **Step 5: Refresh the living-room kiosk and eyeball it**

The Shield FKB serves the old bundle until its cache clears. Read the FKB password, clear cache, and reload (run inside the container so Node handles the password encoding):

```bash
sudo docker exec daylight-station sh -c "node -e \"
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const call = (cmd, extra={}) => {
  const qs = new URLSearchParams({cmd, password: auth.password, type: 'json', ...extra}).toString();
  return fetch('http://10.0.0.12:2323/?' + qs).then(r => r.text()).then(t => console.log(cmd, t.slice(0,120)));
};
call('clearCache').then(() => call('loadStartURL'));
\""
```

Then (optional but recommended) load the game on the TV, screenshot it via FKB, and restore:

```bash
# Load the gameshow route directly
sudo docker exec daylight-station sh -c "node -e \"
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadUrl', url:'https://daylightlocal.kckern.net/app/gameshow', password:auth.password, type:'json'}).toString();
fetch('http://10.0.0.12:2323/?' + qs).then(r=>r.text()).then(console.log);
\""
sleep 8
# Screenshot to the scratchpad and view it with the Read tool
sudo docker exec daylight-station sh -c "node -e \"
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'getScreenshot', password:auth.password}).toString();
fetch('http://10.0.0.12:2323/?' + qs).then(r=>r.arrayBuffer()).then(b=>require('fs').writeFileSync('/tmp/gameshow-tv.png', Buffer.from(b)));
\"" && sudo docker exec daylight-station sh -c 'cat /tmp/gameshow-tv.png' > "$SCRATCHPAD/gameshow-tv.png"
# …view the PNG, then restore the normal screen:
sudo docker exec daylight-station sh -c "node -e \"
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL', password:auth.password, type:'json'}).toString();
fetch('http://10.0.0.12:2323/?' + qs).then(r=>r.text()).then(console.log);
\""
```

(`$SCRATCHPAD` = the session scratchpad directory. If the TV is in use, skip the loadUrl/screenshot and settle for the desktop check from Step 2 — do not hijack the screen.)

Expected: the set-picker renders on the stage gradient with Anton title type; verify by eye, then restore the start URL.

- [ ] **Step 6: Confirm nothing regressed app-wide**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/screen-framework 2>&1 | tail -5
```

Expected: screen-framework suite PASS (GameShow registers as a widget there; this catches import breakage).

---

## Self-Review (completed at plan-writing time)

- **Audit coverage:** §1.1 board fit → Task 4; §1.2 clue budget → Task 5; §1.3 vh → Task 5 Step 5; §1.4 position:relative → Task 6 Step 1; §3.1 tile contrast → Tasks 2+4; §3.2 team-on → Tasks 3+5; §3.3 gold collision → Task 3; §3.4 tokens → Tasks 2+6+7 (verified by zero-hex grep); §3.5 negative color → Task 6 Step 3; §4.1 faces → Tasks 1+2; §4.2 scale → Task 2; §4.3 length buckets → Task 5; §4.4 shadow → tokens `--gs-shadow-text`; §4.5 legend/QR size → Task 6 Steps 1–2; reduced-motion → Task 2. Input/flow findings (§2.x) intentionally out of scope (separate plan).
- **Type consistency:** mixin names `gs.gs-button`/`gs.gs-button-primary` used identically in Tasks 2/6/7; bucket classes `--lg/--md/--sm` identical in Task 5 JSX and SCSS; `onColor`/`TEAM_COLORS` signatures match between Task 3 definition and consumers; `--team-on` producer (Task 3) precedes consumer (Task 5).
- **Placeholder scan:** every code step contains complete, paste-ready content; no TBDs.
