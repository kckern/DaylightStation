# Surround Composed Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the concert-hall surround frame so every element is sized to its container and zoned by meaning — work placard on top, composer (brass) with map and city photo at right, the work-in-time on a dark band below — with nothing clipped, nothing overlapping, and no Player chrome over the video.

**Architecture:** The frame gains a fourth region (`top`), JS-pinned to the media box width like the footer. A new `work-placard` module renders the piece identity on ArtMode's dark-stone plate. The bottom region flips to a dark ground by re-mapping the frame's CSS tokens on the region (module CSS reads the same variables and adapts untouched). ComposerCard sheds the piece block (it moves to the placard), gains the brass name treatment and the city photo, and gets a hard content budget. The definition (data volume) widens the rail to 33% and mounts `country-map`. Sidecar authoring separates piece facts from composer facts.

**Tech Stack:** React (`.jsx`) + SCSS modules, Vitest colocated unit tests, one Playwright runtime gate, YAML sidecars in the Docker data volume.

**Design refs:** `docs/reference/player/surround/design.md` (tokens), `frontend/src/screen-framework/widgets/ArtMode.css` (brass + stone plate recipes, lines 157–239 and 289–326).

## Measured defects this plan fixes (1280×720, live office screen)

| # | Defect | Measurement |
|---|---|---|
| 1 | Player progress bar over the video | teal strip t=18–27 — dispatch lacked `shader=minimal` |
| 2 | Dead gap video → movement rail | video b=594, heading t=639: 45px (19 stage letterbox + 26 empty region top) |
| 3 | Playhead overlaps movement names | playhead t=645–666 vs heading t=639–663 |
| 4 | Rail bio clipped off-screen | fact block b=742 on a 720 screen |
| 5 | Composer bio in the piece zone | 3 of 5 top-level `facts` are bio duplicates of `composer.facts` |
| 6 | Map + Venice photo authored but invisible | `composer.map` + `city_image` in payload; definition never mounts `country-map`; card ignores `city_image` |
| 7 | Materials unused | brass exists only as hairlines; no stone plate; bottom band is paper |

## Decisions (settled with the user — do not reopen)

- **Top placard (new):** the WORK — title, opus, composed, premiered — on ArtMode's **dark stone/silver** plate. Above the video, pinned to media width.
- **Composer name + info:** in the rail, on the **bright brass** treatment. The rail is wholly the person and the place: portrait, name, dates, bio, map, city photo.
- **Bottom band:** the work **in time** — movements, playhead, sonnet cues — on a **dark** ground with light text.
- **Rail width: 33%** (definition-driven). At 1280×720 this makes the video 858×483, freeing ~240px of vertical room that pays for the top placard and an uncramped footer.
- **Right rail keeps the paper texture.**
- The Player's own chrome is suppressed by dispatching with **`shader=minimal`** (alias → `focused`; `frontend/src/modules/Player/Player.jsx:52`). No Player code change.

## Global Constraints

- ES modules; frontend imports are relative (the Surround module uses `../../lib/...` style, match it).
- Frontend unit tests are **colocated** (`frontend/src/modules/Surround/*.test.jsx`) and run with `/opt/Code/DaylightStation/node_modules/.bin/vitest run <path>` (this worktree has no local `.bin`).
- The runtime gate is `tests/live/flow/surround/surround-poc.runtime.test.mjs` (Playwright, against prod on :3111). Run: `npx playwright test tests/live/flow/surround/ --reporter=line` from the worktree root. Its preconditions FAIL rather than skip — keep that property.
- No raw `console.*`; modules receive a `logger` prop; the frame childs it (`SurroundFrame.jsx` `childLogger`).
- The module contract is exactly `{ position, duration, playing, seeking, data, region, logger }` — do not widen it. `contentId` rides inside `data`.
- The 16:9 media lock is the feature's quality floor. Nothing in this plan may distort or crop the video.
- Tokens are declared on `.surround-frame` and read with `var(--x, fallback)` in every module. New surfaces follow that pattern.
- **Data-volume edits (definition YAML, sidecars) are PRODUCTION operations, executed by the controller, not subagents.** Write via `sudo docker exec daylight-station sh -c "echo '<b64>' | base64 -d > <path>"` then `chown node:node`; never `sed -i`; back up to `data/_deleteme/` first. The surround store watches mtimes and rebuilds in ~2s — no restart needed.
- The office screen is a live kiosk reachable over CDP at `localhost:9222`. Restore it to `/screen/office` after any check. Dispatch: `GET /api/v1/device/office-tv/load?play=plex:663146&shader=minimal`.

## File Structure

- `frontend/src/modules/Surround/SurroundFrame.jsx` — add the `top` region band (measured-width, like footer)
- `frontend/src/modules/Surround/SurroundFrame.scss` — header band rules; stage bottom-anchor; dark token re-map on `__region--bottom`
- `frontend/src/modules/Surround/modules/WorkPlacard.jsx` + `.scss` + `.test.jsx` — NEW: stone plate, piece identity
- `frontend/src/modules/Surround/builtins.js` — register `work-placard`
- `frontend/src/modules/Surround/modules/ComposerCard.jsx` + `.scss` — brass name block, city photo, content budget, piece block removed
- `frontend/src/modules/Surround/modules/MovementMap.scss` — text band / rule lane separation
- `tests/live/flow/surround/surround-poc.runtime.test.mjs` — geometry assertions
- Data volume: `data/content/surround/_surrounds/concert-hall.yml`, `data/content/surround/classical/vivaldi/*.yml`, `data/content/surround/classical/beethoven/*.yml`
- Docs: `docs/reference/player/surround/design.md`, `docs/reference/player/surround/classical/README.md`

---

### Task 1: The frame grows a `top` region

**Files:**
- Modify: `frontend/src/modules/Surround/SurroundFrame.jsx`
- Modify: `frontend/src/modules/Surround/SurroundFrame.scss`
- Test: `frontend/src/modules/Surround/SurroundFrame.test.jsx` (extend)

**Interfaces:**
- Consumes: `normalizeRegions(value, slot)`, the existing `renderRegion(region)`, `mediaWidth` state.
- Produces: `definition.regions.top` (object or list, same shape as `bottom`) renders inside `<div className="surround-frame__header">` as the FIRST child of `__main`, width-pinned to the measured media box exactly as `__footer` is. Modules mounted there receive the standard contract.

- [ ] **Step 1: Write the failing tests** (append to the existing region describe block in `SurroundFrame.test.jsx`, matching its harness style — it already mounts the frame with a definition fixture):

```jsx
it('renders a top region band above the stage, width-pinned like the footer', () => {
  const { container } = renderFrame({
    definition: { regions: { top: { module: 'movement-map' }, right: { module: 'composer-card' } } },
  });
  const main = container.querySelector('.surround-frame__main');
  const header = main.querySelector('.surround-frame__header');
  expect(header).toBeTruthy();
  // First child of main: placard above the stage, never between stage and footer.
  expect(main.firstElementChild).toBe(header);
  expect(header.querySelector('.surround-frame__region--top')).toBeTruthy();
});

it('renders no header element at all when the definition has no top region', () => {
  const { container } = renderFrame({ definition: { regions: { right: { module: 'composer-card' } } } });
  expect(container.querySelector('.surround-frame__header')).toBeNull();
});
```

Use the file's existing `renderFrame`/fixture helper — read the test file first and reuse its mount pattern; do not invent a second harness. Note: the `regions: [...]` option passed at registration may or may not be enforced at resolution time — check `registry.js` before choosing the fixture module name; if placement is enforced, use a module registered for `top` (or the test file's own stub module pattern) rather than `movement-map`.

- [ ] **Step 2: Run to verify both fail** — `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/SurroundFrame.test.jsx` → FAIL (`__header` absent).

- [ ] **Step 3: Implement.** In `SurroundFrame.jsx`:

```jsx
const topRegions = useMemo(
  () => normalizeRegions(definition?.regions?.top, 'top'), [definition]);
```

Include `topRegions` in `allRegions` (so missing-module warnings and resolution cover it). Render, as the first child of `__main`, only when `topRegions.length > 0`:

```jsx
{topRegions.length > 0 ? (
  <div
    className="surround-frame__header"
    style={mediaWidth ? { width: `${mediaWidth}px` } : undefined}
  >
    {topRegions.map(renderRegion)}
  </div>
) : null}
```

In `SurroundFrame.scss`, next to `__footer`:

```scss
/* The header belongs to the video exactly as the footer does: JS pins its width
   to the measured media box so the placard reads as the video's nameplate, not
   as page furniture. First child of __main — above the stage, always. */
.surround-frame__header {
  flex: 0 0 auto;
  align-self: center;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.surround-frame__region--top {
  flex: 0 0 auto;
}
```

And close measured defect #2 while in this file — glue the video to the footer by bottom-anchoring the media in the stage (letterbox slack moves above, into the dark hall):

```scss
.surround-frame__stage {
  /* was: align-items: center — that split the letterbox slack above AND below
     the video, opening a dead gap between the video and its own timeline. The
     footer is the video's timeline; they must touch. Slack now lives above,
     where it reads as the darkened house, not as a hole. */
  align-items: flex-end;
}
```

(Only the `align-items` line changes; keep the rest of the rule.)

- [ ] **Step 4: Run the Surround unit suite** — `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/` → all pass, including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/SurroundFrame.jsx frontend/src/modules/Surround/SurroundFrame.scss frontend/src/modules/Surround/SurroundFrame.test.jsx
git commit -m "feat(surround): a top region band, and the video glued to its timeline"
```

---

### Task 2: WorkPlacard — the piece on the stone plate

**Files:**
- Create: `frontend/src/modules/Surround/modules/WorkPlacard.jsx`
- Create: `frontend/src/modules/Surround/modules/WorkPlacard.scss`
- Create: `frontend/src/modules/Surround/modules/WorkPlacard.test.jsx`
- Modify: `frontend/src/modules/Surround/builtins.js`

**Interfaces:**
- Consumes: standard module contract; reads `data.piece` (`title`, `opus`, `composed`, `premiered`) and `data.composer.name` (unused by default — the name lives in the rail per the settled decision).
- Produces: registered module name **`work-placard`**, `regions: ['top']`.

- [ ] **Step 1: Write the failing tests**

```jsx
// WorkPlacard.test.jsx — mirror the mount style of ComposerCard.test.jsx.
import { render } from '@testing-library/react';
import WorkPlacard from './WorkPlacard.jsx';

const DATA = {
  piece: { title: 'Violin Concerto in E major, "Spring"', opus: 'Op. 8 No. 1, RV 269', composed: 'by 1725', premiered: 'Published Amsterdam, 1725' },
  composer: { name: 'Antonio Vivaldi' },
};

it('engraves the piece title and its provenance line', () => {
  const { container } = render(<WorkPlacard data={DATA} position={0} duration={628} playing region={{ slot: 'top' }} />);
  expect(container.querySelector('.surround-work-placard__title').textContent).toContain('Spring');
  const meta = container.querySelector('.surround-work-placard__meta').textContent;
  expect(meta).toContain('Op. 8 No. 1');
  expect(meta).toContain('1725');
});

it('renders nothing without a piece — an empty plate is worse than no plate', () => {
  const { container } = render(<WorkPlacard data={{ composer: { name: 'X' } }} position={0} duration={0} region={{ slot: 'top' }} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail** — module doesn't exist.

- [ ] **Step 3: Implement the component**

```jsx
// frontend/src/modules/Surround/modules/WorkPlacard.jsx
//
// The work's nameplate, above the stage: ArtMode's recessive dark-stone plate
// (see ArtMode.css .artmode__music-plaque) carrying the piece — title, opus,
// composed, premiered. The clock props arrive and are ignored: a placard names
// the work; it does not track it. The composer is NOT named here — the rail
// owns the person (settled decision; brass = composer, stone = work).
import React from 'react';
import PropTypes from 'prop-types';
import './WorkPlacard.scss';

export default function WorkPlacard({ data = null }) {
  const piece = data?.piece ?? null;
  if (!piece?.title) return null;
  const meta = [piece.opus, piece.composed, piece.premiered].filter(Boolean).join('   ·   ');
  return (
    <div className="surround-work-placard" data-testid="surround-work-placard">
      <h2 className="surround-work-placard__title">{piece.title}</h2>
      {meta ? <p className="surround-work-placard__meta">{meta}</p> : null}
    </div>
  );
}

WorkPlacard.propTypes = { data: PropTypes.object };
```

- [ ] **Step 4: The stone plate.** Adapt ArtMode's music-plaque recipe (`ArtMode.css:295–326`) — same brass photo multiplied to near-black, engraved silver-grey text — as a full-width band, not a floating pill:

```scss
// frontend/src/modules/Surround/modules/WorkPlacard.scss
//
// ArtMode's "music plaque" material (dark stone over the brass texture, engraved
// light text) recut as the proscenium nameplate. Deliberately recessive: the
// plate must never compete with the video it sits above. Brass belongs to the
// composer in the rail — this plate is the work's, in silver on stone.
.surround-work-placard {
  padding: 0.55rem 1.4rem 0.6rem;
  text-align: center;
  background-color: #18181a;
  background-image:
    linear-gradient(rgba(20, 20, 23, 0.88), rgba(20, 20, 23, 0.88)),
    url('/api/v1/static/img/ui/plaque/brass.jpg'),
    linear-gradient(180deg, #2c2c31 0%, #3a3a40 36%, #1d1d20 100%);
  background-size: cover, cover, cover;
  background-position: center;
  box-shadow:
    inset 0 1px 0 rgba(180, 184, 196, 0.28),
    inset 0 -1px 0 rgba(0, 0, 0, 0.7);
  font-family: var(--surround-display, "Cormorant Garamond", Georgia, serif);
}

.surround-work-placard__title {
  margin: 0;
  font-size: 1.5rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1.12;
  color: #b9bcc6;                          /* engraved silver */
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.surround-work-placard__meta {
  margin: 0.15rem 0 0;
  font-family: var(--surround-body, "EB Garamond", Georgia, serif);
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  font-variant-caps: small-caps;
  color: #8e9097;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: Register it.** In `builtins.js`, import and add to both the names list and `registerSurroundBuiltins()`:

```js
registerSurroundModule('work-placard', WorkPlacard, { regions: ['top'] });
```

- [ ] **Step 6: Run** — `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/` → all pass (including `registry.test.js`, which asserts the exact builtin set — update its expected list to include `work-placard`; that assertion exists precisely to force this conscious step).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Surround/modules/WorkPlacard.* frontend/src/modules/Surround/builtins.js frontend/src/modules/Surround/registry.test.js
git commit -m "feat(surround): the work's nameplate — stone plate above the stage"
```

---

### Task 3: The bottom band goes dark, and the playhead stays in its lane

**Files:**
- Modify: `frontend/src/modules/Surround/SurroundFrame.scss`
- Modify: `frontend/src/modules/Surround/modules/MovementMap.scss`

No new unit tests — jsdom has no layout; the geometry is pinned by Task 6's runtime assertions. The token re-map is pinned by eye at Task 7.

- [ ] **Step 1: Dark ground by token re-map.** In `SurroundFrame.scss`, extend the `__region--bottom` rule. Modules read `var(--ink)` etc., so re-declaring the tokens ON THE REGION restyles both bottom modules without touching their files:

```scss
.surround-frame__region--bottom {
  flex: 0 0 auto;

  /* The work-in-time band is part of the darkened house, not the programme:
     near-black stone with the text in parchment. Re-mapping the frame tokens
     HERE restyles MovementMap and CueTicker without touching either module —
     they keep reading var(--ink)/var(--ink-soft)/var(--programme-edge). */
  --ink: #e9dfc8;
  --ink-soft: #a89a80;
  --programme-edge: rgba(233, 223, 200, 0.28);
  background-color: #191310;
  background-image: linear-gradient(180deg, #1e1712 0%, #14100c 100%);
  box-shadow: inset 0 1px 0 rgba(233, 223, 200, 0.08);
}
```

Note the velvet active-fill and brass playhead in MovementMap already read `--velvet`/`--brass` and hold up on dark; leave them.

- [ ] **Step 2: Text band vs rule lane.** In `MovementMap.scss`, confine the playhead below the text (measured defect #3 — playhead t=645 rode into heading t=639–663):

```scss
/* The rule lane is the bottom 0.95em; names live strictly above it. The
   playhead never enters the text band — it is a barline, not a cursor. */
.surround-movement-map__heading {
  padding-bottom: 0.45em;          /* was 0.25em — clears the taller lane */
}

.surround-movement-map__playhead {
  bottom: 0;                       /* was -0.15em */
  height: 0.85em;                  /* was 1.35em — text-band overlap */
}

.surround-movement-map__playhead-edge {
  top: -0.14em;                    /* the lit tip may kiss the band edge, not text */
}
```

And tighten the region's internal dead space (part of defect #2 — 26px of empty region top):

```scss
.surround-movement-map {
  padding: 0.3rem 1.1rem 0.5rem;   /* was 0.45rem top — the band no longer floats */
}
```

- [ ] **Step 3: Run the Surround unit suite** (guards against selector typos breaking existing MovementMap tests): `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/` → pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Surround/SurroundFrame.scss frontend/src/modules/Surround/modules/MovementMap.scss
git commit -m "feat(surround): the work-in-time band goes dark, playhead confined to the rule lane"
```

---

### Task 4: ComposerCard — brass identity, city photo, and a hard budget

**Files:**
- Modify: `frontend/src/modules/Surround/modules/ComposerCard.jsx`
- Modify: `frontend/src/modules/Surround/modules/ComposerCard.scss`
- Test: `frontend/src/modules/Surround/modules/ComposerCard.test.jsx` (extend/update)

**Interfaces:**
- Consumes: `data.composer` (`name`, `born`, `died`, `birthplace`, `portrait`, `city_image`, `facts`), `data.assetBase` (however the card already resolves the portrait URL — reuse that exact mechanism for `city_image`; read the component first).
- Produces: the card no longer renders `piece.*` at all (placard owns it). New elements: `__nameplate` (brass), `__city` figure.

- [ ] **Step 1: Write the failing tests** (extend the existing suite; it already has fixtures with `composer` + `piece`):

```jsx
it('no longer prints the piece — the placard owns it', () => {
  const { container } = renderCard();          // existing fixture includes piece
  expect(container.querySelector('.surround-composer-card__piece-title')).toBeNull();
});

it('sets the name on the brass nameplate', () => {
  const { container } = renderCard();
  const plate = container.querySelector('.surround-composer-card__nameplate');
  expect(plate).toBeTruthy();
  expect(plate.textContent).toContain('Antonio Vivaldi');
});

it('shows the city photo when authored, captioned with the city', () => {
  const { container } = renderCard();          // fixture: city_image + map.city 'Venice'
  const fig = container.querySelector('.surround-composer-card__city');
  expect(fig).toBeTruthy();
  expect(fig.querySelector('img').getAttribute('src')).toContain('venice');
  expect(fig.textContent).toContain('Venice');
});

it('renders no city figure when none is authored', () => {
  const { container } = renderCard({ composer: { name: 'X', facts: [] } });
  expect(container.querySelector('.surround-composer-card__city')).toBeNull();
});
```

Existing tests that assert the piece block will now fail — update them to assert its ABSENCE (that is the new contract, not collateral damage; say so in a comment).

- [ ] **Step 2: Run to verify the new tests fail.**

- [ ] **Step 3: Restructure the JSX.** Order inside the card: brass nameplate (name + dates + birthplace, engraved) → portrait plate (existing) → city figure (`city_image` + caption from `map.city`) → `<dl>` data (drop OPUS/COMPOSED/PREMIERED — piece fields gone; keep any composer-scoped datum) → bio fact rotation (existing, at `margin-top: auto`). Resolve the `city_image` URL with the same helper/path join the portrait already uses.

- [ ] **Step 4: The brass nameplate.** ArtMode's brass recipe (`ArtMode.css:157–239`), text engraved by multiply — omit the screws (a rail card, not a frame rail):

```scss
.surround-composer-card__nameplate {
  margin-bottom: 0.7rem;
  padding: 0.45rem 0.9rem 0.5rem;
  text-align: center;
  border: 1px solid #5d4514;
  border-radius: 2px;
  background-color: #c79a3e;
  background-image:
    url('/api/v1/static/img/ui/plaque/brass.jpg'),
    linear-gradient(180deg, #7a5c1d 0%, #e7c266 16%, #f6e3a0 36%, #d8ad4d 62%, #9a772b 100%);
  background-size: cover, cover;
  background-position: center;
  box-shadow:
    0 1px 2px rgba(20, 16, 12, 0.4),
    inset 0 1px 0 rgba(255, 248, 214, 0.85),
    inset 0 -1px 0 rgba(78, 56, 18, 0.75);
}
/* Engraved: multiply lets the metal grain show through the letters. */
.surround-composer-card__nameplate .surround-composer-card__name,
.surround-composer-card__nameplate .surround-composer-card__dates,
.surround-composer-card__nameplate .surround-composer-card__birthplace {
  color: #2a1d07;
  mix-blend-mode: multiply;
  text-shadow: 0 1px 0 rgba(255, 248, 220, 0.5);
}
```

- [ ] **Step 5: The budget — nothing may pass the viewport again** (measured defect #4: fact block b=742 on a 720 screen). The card is a flex column with `overflow: hidden`; make every child yield honestly instead of bleeding:

```scss
.surround-composer-card__portrait { max-height: 26vh; }   /* was 34vh — the rail now also holds a map and a city */

.surround-composer-card__city {
  margin: 0 0 0.7rem;
  line-height: 0;
  img { display: block; width: 100%; max-height: 14vh; object-fit: cover; filter: saturate(0.92); }
  figcaption {
    line-height: 1.2; padding-top: 0.25rem;
    font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--ink-soft, #6b6152);
  }
}

/* Bio facts: at most three lines, ellipsized — never clipped mid-glyph by the
   card edge, never pushed off the screen. */
.surround-composer-card__fact {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 6: Run** — `/opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Surround/` → pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Surround/modules/ComposerCard.*
git commit -m "feat(surround): the rail is the person — brass name, city photo, hard budget"
```

---

### Task 5 (CONTROLLER — production data volume): definition + sidecar authoring

No git commits — the data volume is not version-controlled. Back up both files to `data/_deleteme/` first. The store rebuilds on mtime within ~2s; verify with the `/api/v1/play` probe after each write.

- [ ] **Step 1: Back up** `data/content/surround/_surrounds/concert-hall.yml` and the vivaldi + beethoven sidecars to `data/_deleteme/`.

- [ ] **Step 2: Rewrite `concert-hall.yml` regions** (read the existing file first and preserve any keys not shown here):

```yaml
regions:
  top:
    module: work-placard
  right:
    width: "33%"
    - module: composer-card
    - module: country-map
  bottom:
    - module: movement-map
      height: 64
    - module: cue-ticker
      height: fill
      collapse: first
collapse:
  footerFloor: 90
```

**Shape check before writing:** `regions.right` today is a single object with `width` on it; confirm how `normalizeRegions` + the width read (`definition?.regions?.right?.width`) interact with a LIST under `right` — if width-on-list is not supported, the frame reads `width` from the first entry or the definition needs `right: { width, modules: [...] }`. **Read `SurroundFrame.jsx` and pick the shape the code actually supports; if none supports width-with-list, extend the frame in Task 1 (a `regions.rightWidth` fallback or width on the first entry) rather than authoring YAML the renderer ignores.** This is the one seam in this plan most likely to bite — treat it as part of Task 1's contract and cover it with a unit test there.

- [ ] **Step 3: Fix the fact pools** in `classical/vivaldi/four-seasons-spring.yml` (and the Eroica sidecar): top-level `facts:` keeps ONLY piece facts (the sonnet publication, the score's programmatic markings); the three biography facts (Red Priest, orphanage, died poor in Vienna) are removed — they already exist in `_composer.yml`'s `facts` and render in the rail. The zone contract: **top-level `facts` = the piece; `composer.facts` = the person.**

- [ ] **Step 4: Verify without restart:**

```bash
curl -s "http://localhost:3111/api/v1/play/plex:663146" | jq '.surround.definition.regions | keys'
curl -s "http://localhost:3111/api/v1/play/plex:663146" | jq '.surround.facts'   # piece-only now
```

Also check `https://logs.kckern.net` for `surround.sidecar.invalid` (absolute time range — the store names the file and reason on a bad edit).

---

### Task 6: Runtime geometry gate — the layout can never silently regress again

**Files:**
- Modify: `tests/live/flow/surround/surround-poc.runtime.test.mjs`

The unit suites cannot see layout (jsdom). This gate runs against the real backend and real sidecars — add a `composed layout` describe with assertions derived from this plan's measured defects:

- [ ] **Step 1: Write the assertions** (reuse the file's existing navigation/mount helpers — read it first; it already boots the enriched fixture and waits for `.surround-frame`):

```js
test('the composed layout: nothing clips, nothing overlaps, nothing floats', async ({ page }) => {
  // ... existing enriched-item boot ...
  const box = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    expect(b, `${sel} has no box`).not.toBeNull();
    return b;
  };
  const viewport = page.viewportSize();

  // 1. The placard is mounted, above the video, matching its width (±2px).
  const placard = await box('.surround-frame__header');
  const media = await box('.surround-frame__media');
  expect(placard.y + placard.height).toBeLessThanOrEqual(media.y + 2);
  expect(Math.abs(placard.width - media.width)).toBeLessThanOrEqual(2);

  // 2. The video touches its timeline: gap ≤ 4px (was 19px of letterbox).
  const footer = await box('.surround-frame__footer');
  expect(footer.y - (media.y + media.height)).toBeLessThanOrEqual(4);

  // 3. The playhead never enters the text band.
  const heading = await box('.surround-movement-map__heading');
  const playhead = await box('.surround-movement-map__playhead');
  expect(playhead.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);

  // 4. Every rail child ends on-screen (the bio used to end at 742 of 720).
  for (const sel of ['.surround-composer-card__fact', '.surround-composer-card__nameplate', '.surround-country-map, [data-module="country-map"]']) {
    const count = await page.locator(sel).count();
    if (count === 0) continue;                       // fact may be absent for a composer without facts
    const b = await box(sel);
    expect(b.y + b.height, `${sel} clipped off-screen`).toBeLessThanOrEqual(viewport.height + 1);
  }

  // 5. The rail is a third, not a fifth.
  const rail = await box('.surround-frame__rail');
  expect(rail.width / viewport.width).toBeGreaterThan(0.30);
});
```

The map region selector must match what Task 5 mounts — check the frame's `data-module` attribute rendering and use that, it is guaranteed.

- [ ] **Step 2: Run the gate** — `npx playwright test tests/live/flow/surround/ --reporter=line` (needs Tasks 1–5 deployed OR run against a dev server; if run pre-deploy, note that the gate targets :3111 and defer the run to Task 7's post-deploy verification — do not weaken the test to pass early).

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/surround/surround-poc.runtime.test.mjs
git commit -m "test(surround): geometry gate — clip, overlap, gap and rail-width budgets"
```

---

### Task 7 (CONTROLLER): deploy, verify on the office screen, update docs

- [ ] **Step 1: Deploy gate** (no `playback.render_fps` with `videoState:"playing"` in 75s; `sessionActive:false`, `rosterSize:0` — a paused/idle tab does not block). Build `./scripts/build-daylight.sh`, then stop/rm/`sudo deploy-daylight`, confirm `/build.txt` shows the new SHA.

- [ ] **Step 2: Reload the office screen** (it keeps the old bundle until reloaded — this exact miss cost an hour earlier today), then dispatch **with the chrome suppressed**:

```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?play=plex:663146&shader=minimal"
```

- [ ] **Step 3: Run the Task 6 gate against prod**, then screenshot the live office screen over CDP (`localhost:9222`) and **look at it** — the gate proves geometry; only eyes prove the brass reads as brass and the stone as stone. Verify: no teal progress bar, placard above video, dark bottom band with light text, brass name in rail, map + Venice photo visible, nothing clipped.

- [ ] **Step 4: Docs to endstate** (present tense, no changelog): `design.md` gains the four-zone contract (top=work on stone, right=person on paper with brass, bottom=work-in-time on dark, media inviolable) and the token re-map pattern for dark regions; `classical/README.md` gains the fact-pool contract (top-level `facts` = piece, `composer.facts` = person) and the canonical dispatch URL including `&shader=minimal`.

- [ ] **Step 5: Commit docs**

```bash
git add docs/reference/player/surround/
git commit -m "docs(surround): the four-zone contract, dark-region tokens, and the canonical dispatch"
```

---

## Out of scope (deliberately)

- Auto-suppressing Player chrome whenever a surround is active (today: the `shader=minimal` dispatch parameter; a Player-side rule is a separate decision).
- The pop-up-video overlay cue phase (`render: overlay` cues are still ignored by design).
- An Amsterdam city asset (only `venice.jpg` exists; the card renders what is authored).
- Enforcing the fact-pool zone contract in sidecar validation (`surround.sidecar.invalid`) — authoring + docs now, lint later.

## Self-review notes

- Task 5's region-shape check is intentionally cross-wired into Task 1: if `width` cannot ride a list, the FRAME change lands in Task 1 with a unit test, and Task 5 authors whichever shape the code supports. The implementer of Task 1 must read `SurroundFrame.jsx`'s `railWidth` read and decide there, not discover it in production YAML.
- Type consistency: `work-placard` (registry name), `.surround-work-placard__*`, `.surround-frame__header`, `.surround-frame__region--top` are the only new identifiers; Tasks 2, 5 and 6 all use exactly these.
