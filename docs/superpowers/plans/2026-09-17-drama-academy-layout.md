# Drama Academy Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a 4:3 stage production readable — first by guaranteeing no declared aspect ratio can crush the band off the screen, then by giving Academy-ratio works a transposed layout that spends the screen's spare width on a wide rail instead of on empty drape.

**Architecture:** Two phases. **(A) The floor**, already written and unverified in the working tree: the frame measures its own column and publishes `--surround-media-cap-w`, the widest the picture may be while the band keeps a reserve; the media box becomes `width: min(100%, var(--surround-media-cap-w, 100%))`, so 16:9 resolves to `100%` and every classical frame is untouched. **(B) The layout**, which exploits the fact that `YamlSurroundStore` selects a presentation definition by the corpus file's own `surround:` key (`YamlSurroundStore.mjs:1253`) — so a 4:3 work can point at a *different* `_surrounds/` definition and get a completely different region arrangement with **zero frontend or backend branching on aspect ratio**. The transposed definition puts identity, the Act/Scene timeline and both listening registers in one wide rail, and gives the picture the whole column.

**Tech Stack:** React 18, SCSS (sass-embedded), Vitest + Playwright (`band.measure.test.jsx` renders the real frame in a real browser against the compiled shipped stylesheet), YAML corpus in the Docker data volume.

**Spec:** `docs/superpowers/specs/2026-09-16-drama-surround-design.md`
**Predecessor plan:** `docs/superpowers/plans/2026-09-16-drama-surround.md` (Tasks 1–10, all shipped — their commits are in git history even though the file's checkboxes were never ticked). **Do not redo those tasks.** This plan starts where Task 4 stopped.

## Status

> Phase 1 / Phase 2 are deliberately neutral names. They were "Movement A/B"
> — the *classical* structure word, in a plan about a play. "Act" would be no
> better: this document discusses the play's own Acts throughout, so the two
> would collide. Plan scaffolding borrows no domain's structure vocabulary,
> for the same reason the code does not (see Global Constraints).

**Phase 1 is complete and deployed** (2026-09-17). Tasks 1-3 are ticked below.

- Cap proven: full Surround suite **27 files, 1003 passed / 2 expected fail**, zero
  regressions; all nine 4:3 assertions green at every fleet root.
- Shipped as `70cb090f4`, deployed as `ecc18b668` (verified against `/build.txt`,
  which read `4376a95ff` before the deploy).
- Measured on the live app at the living-room root, 33% rail:

  | | before | after |
  |---|---|---|
  | stage | 549.6px in a 540px column | 428.7px |
  | picture | 643.2x482.4 | 482x361.5, ratio 1.333 |
  | band | **0.4px** | **121.3px** |
  | band regions | segment-map only (ticker deleted) | segment-map 82px + cue-ticker 40px |

  The band measures 121.3 rather than the authored 111 reserve because the reserve
  is a floor the footer grows past, plus `--band-overlap: 10px` — the band rides up
  over the picture's foot, so its box is 10px taller than its share of the column.

**A vocabulary pass landed alongside Phase 1** (2026-09-17). The rail's hierarchy
machinery was generic and recursive but had been NAMED after two corpora: level 0
was "part" and level 1 "scene", so a ballet's level 1 was called a Scene in code.
Renamed to depth-relative names, with `tempo` -> `term` following for the same
reason. `SegmentMap.test.jsx` now carries "one rail, any corpus": a symphony
(flat), a play (Act > Scene) and a ballet (Act > Scene > Dance) through the
identical component, asserting that a two-level and a three-level corpus emit
IDENTICAL markup vocabulary, and that no emitted class or testid names a use
case. That check would have caught `__fold-scenes`, `surround-part-group-label`
and `__tempo`. Suite: 1012 passed / 2 expected fail.

**Phase 2 is being built** (2026-09-17), to a design approved in conversation.
It supersedes Tasks 4-8 as written below in three ways worth recording:

- **It is `playhouse-rail`, not `playhouse-academy`.** "Academy" is the film
  term for the ~4:3 frame; naming a LAYOUT after an aspect RATIO repeats the
  mistake the vocabulary pass removed. The name says what the layout does.
- **The rail is on the RIGHT** (the frame's default; `playhouse` is what opts
  into `side: left`), so the video sits left and the timeline's spine — in the
  rail's inner gutter — lies against the picture. That is the horizontal rule's
  own law, transposed: the timeline is the picture's edge, not furniture.
- **One timeline module, not two.** `orientation: row | column` is declared on
  the region beside `width`/`side`/`height`, and `CueTicker` takes the same key.
  A separate `SegmentColumn` module would have been a use case baked into the
  module list.

Settled design, as built:

| | |
|---|---|
| rail | 40% = 384px, right |
| picture | 576x432, exact 4:3, `mediaReserve: 0` |
| rail stacks | play-card (~150px), timeline (`height: fill`), ticker (~130px) |
| rows | EQUAL height; progress lives on the spine in ROW space |
| playhead | `(sounding row + fraction through it) / row count` — `playheadFraction` reused untouched with equal shares |
| the Act | rides in a compound mark (`I.1`), no heading rows |
| retired on this axis | folds, the accordion, group heading rows, `nowSide`/`NOW_PANEL_SHARE`, the bond's connector |
| the bond | shared ground colour only — rows sit between the sounding row and the register, so a weld is geometrically impossible |
| place-carousel | not mounted: no height, and this play authors no `piece.map`, so the only place material is the playwright's birthplace against a "Padua, Italy" setting line |

**`design.md` could not be updated.** It is root-owned (`-rw-r--r-- root:codedev`)
and this repo is worked as `ds`; sudo here is docker-scoped and chowning repo
files is against standing practice. The directory IS writable, so deleting and
recreating the file would have worked — and was deliberately not done, because
that is a permission end-run on a protected document rather than a docs update.
The material lives at `docs/reference/player/surround/orientation.md` instead and
should be folded in when someone can write the original:
`sudo chown ds docs/reference/player/surround/design.md`.

**Phase 2 (Tasks 4-8) is planned and not started.**

## Why this plan exists

Predecessor Task 4 generalized the media box to `piece.aspectRatio` and verified it with a unit assertion — that the inline style string reads `"4 / 3"`. Nothing in it measured a layout. The spec had explicitly flagged the gap:

> **Verification needed during implementation** (not resolved by this spec): sweep `SurroundFrame.scss` for anything that assumes the media box's shape … must be confirmed against a real 4:3 render, not assumed.

That sweep never became a task. The only check that would have caught the result was predecessor Task 10 Step 6 — a manual, optional, end-of-plan eyeball that even warned *"do not claim visual confirmation that was not actually performed."* It shipped unconfirmed.

**Measured consequence** (live, 960×540 root, 33% rail, commit `4376a95ff`):

| box | measured |
|---|---|
| main column | 643.2 × 540 |
| stage | 643.2 × **549.6** — 9.6px taller than the column holding it |
| media | 643.2 × 482.4 (exactly 4/3 — never distorted) |
| **footer (the band)** | 643.2 × **0.4px** |

The band's modules were mounted and working the whole time: `cue-ticker` had fitted all 24 of its notes and `segment-map` had measured its 11-scene rail (`surround.rail.density`, `railPx: 608`). They were laid out in four tenths of a pixel, one pixel above the bottom edge. Because `0.4 > 0` and `0.4 < 90`, the collapse rule then fired and **deleted the ticker outright**, taking both listening registers with it. Nothing errored; the logs look healthy; the only symptom is a screenshot with nothing under the picture.

**So the closing gate of this plan is automated and non-optional** (Task 1's spec runs in the standard Surround suite), not a human remembering to look below a video.

## Global Constraints

Inherited verbatim from the predecessor plan; every task's requirements implicitly include these.

- **No domain-specific vocabulary in code.** "Act," "Scene," "Shakespeare," "play" must never appear in frontend/backend logic — only as corpus-authored `kind:`/`title:` values. Every new field (`genre`, `setting`, `characters`, `aspectRatio`) is domain-agnostic and usable by `classical` too.
- **Additive and backward-compatible.** Every change must default to today's `classical` behavior when the new field is absent. Run the full existing Surround test suite after every task; a regression there blocks the task.
- **Repo split.** Code changes (frontend/backend/docs) live in `/opt/Code/DaylightStation` (git). Content authoring (corpus, sidecar, presentation definition) lives in `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data`, which is **not** a git repo — never `rm` there; the store watches mtimes, so authoring is edit-and-refresh; back up before overwriting.
- **`characters:` merge rule differs from `facts:`.** `facts:` accumulates (every distinct string across the hierarchy rotates); `characters:` overrides by `name` (nearest level wins per name, not both).
- Follow TDD for every code task: failing test first, minimal implementation, passing test, commit.

### Additional constraints for this plan

- **No code may branch on aspect ratio.** The layout difference is carried entirely by which `_surrounds/` definition a corpus file names. A frontend `if (ratio === '4 / 3')` fails review.
- **Writing into the data volume:** `sudo docker exec -i` is **not** covered by the NOPASSWD sudoers rule and fails with the misleading `sudo: a terminal is required to read the password`; `docker cp` is not covered either. Carry bytes in the command string instead, and verify with `wc -c` on both sides:
  ```bash
  B64=$(base64 -w0 /tmp/file.yml)
  sudo docker exec daylight-station sh -c "echo '$B64' | base64 -d > data/content/surround/_surrounds/file.yml"
  sudo docker exec daylight-station sh -c 'wc -c data/content/surround/_surrounds/file.yml'
  ```
  `cat >` truncates in place, so the file keeps its `node:node` ownership and needs no chown. This also sidesteps the standing ban on `sed -i` for YAML — the file is replaced byte-for-byte.

---

## File Structure

**Phase 1 — the floor (uncommitted work already in the tree):**

- `frontend/src/modules/Surround/SurroundFrame.jsx` — **modified.** `ratioOf()` helper; `mediaReserve` read from `definition.collapse.mediaReserve ?? footerFloor`; `mainRef`/`stageRef`; the ResizeObserver gains a `mainRef` branch computing the cap; `--surround-media-cap-w` published in `rootStyle`.
- `frontend/src/modules/Surround/SurroundFrame.scss` — **modified.** `.surround-frame__media` width becomes `min(100%, var(--surround-media-cap-w, 100%))`.
- `frontend/src/modules/Surround/band.measure.test.jsx` — **modified.** New `describe('a corpus-declared 4:3 picture, measured')` with three assertions; `layout()`'s effect emulation still needs the cap publish (Task 1).

**Phase 2 — the transposed layout:**

- `frontend/src/modules/Surround/builtins.js` — **modified.** Slot meta widened so rail-borne band modules and a strip-borne identity card are declared rather than merely tolerated.
- `frontend/src/modules/Surround/modules/CueTicker.scss` — **modified.** A stacked variant for when the ticker is a column rather than a strip.
- `frontend/src/modules/Surround/modules/SegmentMap.jsx` — **modified** (revised; was "create `SegmentColumn.jsx`"). The vertical Act/Scene timeline. Reuses `band.js`'s share solvers unchanged (they are axis-agnostic: `railPx` is "axis length", `floorPx`/`desiredPx` are "axis units a segment needs"); replaces only the probe, because `needs[i]` today is "how wide does this heading set on one line" and its vertical equivalent is "how tall does it set wrapped at the rail's width."
- `frontend/src/modules/Surround/modules/SegmentColumn.scss` — **created.**
- `data/content/surround/_surrounds/playhouse-academy.yml` — **created** (data volume).
- `data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml` — **modified** (data volume): `surround: playhouse-academy`.
- `docs/reference/player/surround/design.md` — **modified.** The cap, and the academy layout.

---

### Task 1: Prove the media cap in the measured harness

The frame code and the stylesheet are already written and sitting uncommitted. They are **unproven**: the spec is red at 4 failed / 5 passed, *identical to before the fix*, because `band.measure.test.jsx` renders with `renderToStaticMarkup` — which runs no effects — and hand-emulates each of the frame's effects in `layout()`. It publishes `--surround-media-w`, `--label-floor` and the collapse, and knows nothing about `--surround-media-cap-w`. Until the emulation carries the cap, the harness measures a frame the shipped component would never produce.

**Files:**
- Modify: `frontend/src/modules/Surround/band.measure.test.jsx:707-726` (the `page.evaluate` effect-emulation block in `layout()`)
- Already modified, to be committed with this task: `frontend/src/modules/Surround/SurroundFrame.jsx`, `frontend/src/modules/Surround/SurroundFrame.scss`, and the new `describe` block at the end of `band.measure.test.jsx`

**Interfaces:**
- Consumes: `DEFINITION.collapse.footerFloor` (90), `DEFINITION.collapse.mediaReserve` (absent in the harness fixture → falls back to `footerFloor`)
- Produces: `--surround-media-cap-w` on `.surround-frame`, read by `.surround-frame__media`'s `width: min(100%, …)`. Task 7's academy definition sets `collapse.mediaReserve: 0` to opt out of the reserve entirely.

- [x] **Step 1: Confirm the spec is red, and red for the stated reason**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/band.measure.test.jsx -t "4:3"`
Expected: FAIL — `4 failed | 5 passed`. Specifically: all three `the band keeps at least its collapse floor` cases fail (`the band is 0.4px` at 960×540, `58px` at 1920×1080), and `'960x540' — the stage never outgrows the column it sits in` fails with `the stage is 549.6px inside a 540px column`. The three `keeps the ratio the corpus declared` cases PASS — the picture is not distorted, the band is crushed.

- [x] **Step 2: Teach the harness's effect emulation to publish the cap**

In `layout()`, replace the `page.evaluate` block so the cap is computed **before** the footer's height is read — the cap is what changes that height, so emulating it afterwards measures the old layout:

```js
  await page.evaluate(({ footerFloor, mediaReserve, labelFloorCss }) => {
    const root = document.querySelector('.surround-frame');
    root.style.setProperty('--label-floor', `${labelFloorCss}px`);
    root.classList.remove('surround-frame--entering', 'surround-frame--arriving');
    const media = document.querySelector('[data-testid="surround-media"]');
    const footer = document.querySelector('[data-testid="surround-footer"]');

    // EFFECT 2b — THE MEDIA CAP, reproduced. The component measures the main
    // column and publishes the widest the picture may be while the band keeps
    // its reserve. Without it every non-16:9 payload on this page lays out
    // uncapped — which is the defect the cap exists to prevent, not a
    // measurement of the shipped frame. It runs BEFORE the footer is measured
    // below, because the cap is precisely what decides that height.
    const main = document.querySelector('.surround-frame__main');
    const stage = document.querySelector('.surround-frame__stage');
    const ratioText = root.style.getPropertyValue('--surround-aspect-ratio').trim() || '16 / 9';
    const [rw, rh = '1'] = ratioText.split('/');
    const ratio = Number(rw.trim()) / Number(rh.trim());
    if (main && stage && Number.isFinite(ratio) && ratio > 0) {
      const padTop = parseFloat(getComputedStyle(stage).paddingTop) || 0;
      const capH = main.getBoundingClientRect().height - padTop - mediaReserve;
      if (capH > 0) root.style.setProperty('--surround-media-cap-w', `${Math.round(capH * ratio)}px`);
    }

    const w = media.getBoundingClientRect().width;
    root.style.setProperty('--surround-media-w', `${w}px`);
    if (footer) {
      footer.style.width = `${w}px`;
      const h = footer.getBoundingClientRect().height;
      // `collapse: first` drops the FIRST region of the band when the whole band
      // cannot afford the floor. Emulated by removing the region, which is what
      // `visibleFooterRegions` does.
      if (h > 0 && h < footerFloor) {
        const first = footer.querySelector('.surround-frame__region--bottom');
        if (first) first.remove();
      }
    }
  }, {
    footerFloor: DEFINITION.collapse.footerFloor,
    mediaReserve: DEFINITION.collapse.mediaReserve ?? DEFINITION.collapse.footerFloor,
    labelFloorCss: labelFloor,
  });
```

- [x] **Step 3: Run the 4:3 spec and confirm it is green**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/band.measure.test.jsx -t "4:3"`
Expected: PASS, 9 passed. The derived geometry at 960×540 with a 33% rail and the default reserve of 90: `capH = 540 − 67.2 − 90 = 382.8`, `capW = 382.8 × 4/3 = 510.4`, so the picture is 510×383, the stage is 450 (≤ 540), and the band is exactly 90. At 1280×720 the picture is 750×563; at 1920×1080, 1230×923. The band is 90 at all three.

- [x] **Step 4: Run the whole Surround suite for regressions**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/`
Expected: PASS with **zero** regressions against the recorded baseline for `band.measure.test.jsx` of **100 passed | 2 expected fail (102)**. The two `it.fails` entries are pre-existing recorded gaps (the corner-plate harness gap and the lyric-rail panel sizing) and must remain *expected* failures — if either flips to passing, promote it rather than ignoring it. Total for the file becomes 109 passed | 2 expected fail (111).

The 16:9 path must be provably untouched: on a 16:9 payload the cap resolves past the column (at 960×540, `382.8 × 16/9 = 680px` against a 643px column), so `min(100%, 680px)` picks `100%` — literally the declared value before this change.

- [x] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/SurroundFrame.jsx \
        frontend/src/modules/Surround/SurroundFrame.scss \
        frontend/src/modules/Surround/band.measure.test.jsx
git commit -m "fix(surround): cap the media box so a tall picture cannot crush the band

A corpus-declared 4:3 picture at the full column width is a third taller
than the 16:9 box this frame's geometry was tuned against, so the stage
outgrew the screen root and the band — which absorbs the column's slack —
was squeezed to 0.4px on the living-room root. The collapse rule then
dropped the ticker outright, taking both listening registers with it.

The frame now measures its own column and publishes the widest the picture
may be while the band keeps a reserve; the media box takes min(100%, cap).
Width is capped rather than height: clamping height while width stays at
100% is how a picture gets stretched, and the quality floor says never
distort. On 16:9 the cap resolves past the column, so min() picks 100% and
every classical frame is unchanged.

Reserve defaults to collapse.footerFloor and is authorable per definition
as collapse.mediaReserve."
```

---

### Task 2: Give the shipped playhouse its chosen band height

Task 1's default reserve (`footerFloor`, 90) yields a 510×383 picture and a 90px band. The owner chose the deeper band — classical's own 111px at the living-room root, giving a 482×362 picture — so the shipped definition authors it. This is an interim: Task 7 supersedes it for Academy works. Do it anyway, so the pilot play is watchable while the rest of the plan is built.

**Files:**
- Modify: `data/content/surround/_surrounds/playhouse.yml` (data volume)

**Interfaces:**
- Consumes: `collapse.mediaReserve`, read by `SurroundFrame.jsx` from Task 1.

- [x] **Step 1: Back up the current definition**

```bash
sudo docker exec daylight-station sh -c 'cat data/content/surround/_surrounds/playhouse.yml' > /tmp/playhouse.yml.bak
wc -c /tmp/playhouse.yml.bak
```

- [x] **Step 2: Write the definition with the reserve authored**

```bash
cat > /tmp/playhouse.yml <<'YAML'
# The playhouse surround: a printed programme beside the stage, for a drama
# work rather than a piece of music. See docs/reference/player/surround/design.md
# and docs/superpowers/specs/2026-09-16-drama-surround-design.md.
#
# Same zone shape as concert-hall: the TOP placard is the work; the RAIL is
# the play's own identity (title/genre/setting + rotating facts and
# hierarchy-scoped character cards); the BOTTOM band is the work in time
# (Act/Scene rail, current-Act-expanded, with Act commentary on the left and
# Scene watch-for notes on the right — both already generic, reused as-is
# from the classical domain's groups/segments machinery).
id: playhouse
regions:
  top:
    module: work-placard
  right:
    - module: play-card
      width: "33%"
      side: left
    - module: place-carousel
  bottom:
    - { module: segment-map, height: 64 }
    - { module: cue-ticker, height: fill, collapse: first }
collapse:
  footerFloor: 90
  # THE BAND'S RESERVE. A 4:3 picture is a third taller than a 16:9 one at the
  # same width, so without a reserve the stage outgrows the column and the band
  # goes off the bottom of the screen. 111px is what the band measures on a
  # 16:9 work at the living-room root — this domain's pictures are Academy
  # ratio, and the band should not be shallower here than it is there.
  mediaReserve: 111
YAML
B64=$(base64 -w0 /tmp/playhouse.yml)
sudo docker exec daylight-station sh -c "echo '$B64' | base64 -d > data/content/surround/_surrounds/playhouse.yml"
sudo docker exec daylight-station sh -c 'wc -c data/content/surround/_surrounds/playhouse.yml'
wc -c /tmp/playhouse.yml
```

Expected: the two `wc -c` byte counts are identical.

- [x] **Step 3: Confirm the store serves it**

```bash
curl -s "http://localhost:3111/api/v1/play/plex:697661" | jq '.surround.definition.collapse'
```

Expected: `{"footerFloor": 90, "mediaReserve": 111}`. If it still reads `{"footerFloor": 90}`, the store is serving a cached index — it re-stats on a 2s freshness window, so re-run once before investigating.

---

### Task 3: Deploy and confirm on real glass

Task 1's proof is a harness. The defect was *visible on a television and invisible everywhere else*, so it does not count as fixed until a real browser against the real app shows a band.

**Files:** none (build and deploy only)

- [x] **Step 1: Run the deploy gate as its own step — it must be able to halt the sequence**

```bash
./scripts/deploy-gate.sh
```
Expected: exit 0. On exit 1 **stop**: someone is using the system (a fitness session, a playing video, a child at the school Portal or the piano kiosk, or a garage lockdown). The gate fails closed on an unreachable log store, which is correct and not overridable.

- [x] **Step 2: Build**

```bash
./scripts/build-daylight.sh
```

- [x] **Step 3: Re-run the gate, then deploy**

A build takes minutes and someone can walk up in that time.

```bash
./scripts/deploy-gate.sh && \
  sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [x] **Step 4: Measure the live frame headless — do not trust the eye alone**

```bash
cat > /tmp/measure-shrew.mjs <<'EOF'
import { chromium } from '/opt/Code/DaylightStation/node_modules/playwright/index.mjs';
const URL = 'http://localhost:3111/tv?play=' + encodeURIComponent('plex:697661');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-testid="surround-frame"]', { timeout: 45000 });
await page.waitForTimeout(4000);
const out = await page.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  return { main: r('.surround-frame__main'), stage: r('.surround-frame__stage'),
    media: r('[data-testid="surround-media"]'), footer: r('[data-testid="surround-footer"]'),
    regions: [...document.querySelectorAll('.surround-frame__region--bottom')].map((e) => e.dataset.module) };
});
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: '/tmp/shrew-live.png' });
await browser.close();
EOF
node /tmp/measure-shrew.mjs
```

Expected: `footer.h` ≈ 111 (not 0.4), `stage.h` ≤ `main.h`, `media` ≈ 482×362 with ratio 1.333, and `regions` contains **both** `segment-map` and `cue-ticker` — the ticker's presence is the proof the collapse rule did not fire.

- [x] **Step 5: Reload the living-room kiosk so the Shield picks up the new bundle**

```bash
sudo docker exec daylight-station sh -c "node -e \"
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.12:2323/?' + qs).then(r=>r.text()).then(console.log);
\""
```

Expected: a JSON response. `type=json` is required — without it FKB returns the HTML dashboard, which looks like an auth failure and is not one.

- [x] **Step 6: Leave no scratch file behind**

Write the measurement script into the session scratchpad rather than `/tmp`, and
there is nothing to sweep up afterwards. (On the run of record it lived in the
scratchpad, so the `_deleteme/` move this step originally prescribed had no
subject. If you do stage it in `/tmp`, move it: `mkdir -p _deleteme && mv
/tmp/measure-shrew.mjs _deleteme/` — `rm` is permission-blocked here.)

---

### Task 4: Declare the slots the transposed layout needs

`builtins.js` records the slots each module was cut for, and `SurroundFrame` warns `surround.module.misplaced` when a definition puts one elsewhere — it renders anyway, because an author may mean it. The academy layout means it, so the declaration should say so rather than leaving a warning in the log store for every play.

**Files:**
- Modify: `frontend/src/modules/Surround/builtins.js`
- Test: `frontend/src/modules/Surround/registry.test.js`

**Interfaces:**
- Produces: `cue-ticker` declared for `['bottom', 'right']`; `play-card` for `['right', 'top', 'bottom']`; `segment-column` (Task 6) registered for `['right']`.

- [ ] **Step 1: Write the failing test**

```js
it('declares the slots the academy layout uses, so a rail-borne band is not misplaced', () => {
  resetSurroundRegistry();
  registerSurroundBuiltins();
  const registry = getSurroundRegistry();
  expect(registry.getMeta('cue-ticker').regions).toEqual(expect.arrayContaining(['bottom', 'right']));
  expect(registry.getMeta('play-card').regions).toEqual(expect.arrayContaining(['right', 'top']));
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/registry.test.js -t "academy"`
Expected: FAIL — `cue-ticker` currently declares `['bottom']` only.

- [ ] **Step 3: Widen the declarations**

In `BUILTIN_MODULES`:

```js
  ['cue-ticker', CueTicker, { regions: ['bottom', 'right'] }],
  ['play-card', PlayCard, { regions: ['right', 'top', 'bottom'] }],
```

- [ ] **Step 4: Run the registry tests**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/registry.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/builtins.js frontend/src/modules/Surround/registry.test.js
git commit -m "feat(surround): declare the rail and strip slots the academy layout uses"
```

---

### Task 5: A stacked variant of the listening band

In the transposed layout `cue-ticker` is a column, not a strip. Its two registers sit side by side today, divided by a hairline, with an out-of-flow `__ground` panel that slides horizontally on a `--now-left` percentage to carry the bond. Stacked, they divide horizontally and the panel travels vertically.

The module already renders `data-region-slot` nothing — it receives `region` in the module contract, so the variant is selected by the slot it was placed in, **not** by anything about the content.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/CueTicker.jsx` (root className gains a `--column` modifier when `region.slot === 'right'`)
- Modify: `frontend/src/modules/Surround/modules/CueTicker.scss`
- Test: `frontend/src/modules/Surround/modules/CueTicker.test.jsx`

**Interfaces:**
- Consumes: `region.slot`, already passed to every module by `SurroundFrame.renderRegion`.
- Produces: `.surround-cue-ticker--column` on the root.

- [ ] **Step 1: Write the failing test**

```js
it('wears the column modifier when the definition puts it in the rail', () => {
  const { getByTestId } = render(
    <CueTicker position={1200} duration={3223} playing data={DATA} region={{ slot: 'right' }} />,
  );
  expect(getByTestId('surround-cue-ticker').className).toContain('surround-cue-ticker--column');
});

it('does not wear it in the band, which is the shipped arrangement', () => {
  const { getByTestId } = render(
    <CueTicker position={1200} duration={3223} playing data={DATA} region={{ slot: 'bottom' }} />,
  );
  expect(getByTestId('surround-cue-ticker').className).not.toContain('surround-cue-ticker--column');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/modules/CueTicker.test.jsx -t "column"`
Expected: FAIL — no such class.

- [ ] **Step 3: Add the modifier and the stacked stylesheet**

In `CueTicker.jsx`, add to the root className expression:

```js
${region?.slot === 'right' ? ' surround-cue-ticker--column' : ''}
```

In `CueTicker.scss`, stack the zones and turn the bond's travel:

```scss
/* THE COLUMN VARIANT. In the academy layout the ticker is a rail module, so
   its two registers divide horizontally and the hairline between them runs
   across rather than down. The bond's ground travels on the other axis with
   them — it is positioned, so this is a change of which offset it animates,
   not of what it is. */
.surround-cue-ticker--column {
  .surround-cue-ticker__zones { flex-direction: column; }

  .surround-cue-ticker__zone--piece { border-right: 0; border-bottom: 1px solid var(--programme-edge); }

  .surround-cue-ticker__ground {
    left: 0;
    width: 100%;
    height: 50%;
    top: var(--now-top, 50%);
    transition: top var(--accordion-ms) linear;
  }
}
```

In `CueTicker.jsx`, publish `--now-top` alongside the existing `--now-left` on the ground element so the two axes read the same decision:

```js
style={{ '--now-left': `${panelLeft * 100}%`, '--now-top': `${panelLeft * 100}%` }}
```

- [ ] **Step 4: Run the ticker tests**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/modules/CueTicker.test.jsx`
Expected: PASS — including every existing band-arrangement test, which must be unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/modules/CueTicker.jsx frontend/src/modules/Surround/modules/CueTicker.scss frontend/src/modules/Surround/modules/CueTicker.test.jsx
git commit -m "feat(surround): a stacked column variant of the listening band"
```

---

### Task 6: the timeline on a vertical axis

> **REVISED 2026-09-17 — read this before the steps below.** This task was
> written as "create a new `SegmentColumn` module". That is wrong, and for the
> same reason the vocabulary pass above exists: two modules for *the timeline*,
> differing only in axis, is a use case baked into the module list. It should be
> ONE timeline module with `orientation: row | column` declared on the region in
> the definition, defaulting to `row` — exactly as `nowSide`, `railDensity`,
> `width` and `side` already are. The internals differ (the probe measures a
> line's width in a row and its wrapped height in a column) but that is a branch
> on a declared prop, not on a domain. One module then serves the symphony, the
> play, the ballet, and both aspect ratios.
>
> **The steps below still describe the superseded new-module approach.** They are
> left rather than rewritten because Step 1 already routes this task's visual
> grammar through brainstorming, where they will be re-derived; rewriting them
> now would be precision this task has not earned yet.

The one genuinely new module. `SegmentMap` is horizontal to the bone — but the split is favourable and worth stating precisely, because it decides the size of this task:

- **Reusable unchanged:** `accordionShares`, `playheadFraction`, `elapsedFraction`, `activeSegmentIndex`, `placedRailSegments`, `railGroups`, `collapseInactiveGroups`, `foldedShares`, `numeral`/`numeralText`. These solve in abstract px along *one axis*; `railPx` is simply "axis length" and `floorPx`/`desiredPx` are "axis units this segment needs." Nothing in them knows the axis is horizontal.
- **Not reusable:** the probe (`measureRail`). Today `needs[i]` is *how wide this heading sets on one line*, measured off real DOM in the real face. The vertical equivalent is *how tall it sets wrapped at the rail's width* — a different measurement of a different box.
- **Not reusable:** `SegmentMap.scss` (1075 lines of horizontal rule, barlines, fills and bond connector).

A vertical Act/Scene list is the natural shape for a stage work — it is a table of contents, which is what a playbill prints. At the living-room root a 384px-wide rail over 540px of height gives ~38px per scene across 14 scenes: room for one line of label each, with the accordion expanding the sounding one to show its gloss.

> **This task deserves its own design pass before implementation.** The mechanism is settled (reuse the solvers, replace the probe), but the visual grammar — where the playhead sits, how a folded Act reads vertically, whether the bond survives — is a design decision, not a transcription. Run `superpowers:brainstorming` against `docs/reference/player/surround/design.md` before Step 1 rather than inventing it here.

**Files:**
- Create: `frontend/src/modules/Surround/modules/SegmentColumn.jsx`
- Create: `frontend/src/modules/Surround/modules/SegmentColumn.scss`
- Create: `frontend/src/modules/Surround/modules/SegmentColumn.test.jsx`
- Modify: `frontend/src/modules/Surround/builtins.js` (register `segment-column` for `['right']`)

**Interfaces:**
- Consumes: the standard module contract `{ position, duration, playing, seeking, data, region, logger }`; `band.js`'s exported solvers listed above.
- Produces: `[data-testid="surround-segment-column"]`; module name `segment-column`.

- [ ] **Step 1: Brainstorm the vertical grammar** (see the note above) and record the outcome in `docs/reference/player/surround/design.md` under a new "Academy layout" heading.

- [ ] **Step 2: Write the failing test** — one segment per authored scene, the sounding one marked, and the rail's measured axis being its **height**:

```js
it('renders one entry per placed segment and marks the sounding one', () => {
  const { getByTestId, getAllByTestId } = render(
    <SegmentColumn position={1200} duration={3223} playing data={DATA} region={{ slot: 'right' }} />,
  );
  expect(getByTestId('surround-segment-column')).toBeInTheDocument();
  const entries = getAllByTestId(/^surround-segment-column-entry/);
  expect(entries).toHaveLength(DATA.segments.length);
  expect(entries.filter((e) => e.dataset.sounding === 'true')).toHaveLength(1);
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/modules/SegmentColumn.test.jsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement the module and its stylesheet**, per the brainstormed grammar, reusing the solvers named above and observing the rail's **height** where `SegmentMap` observes its rule's width.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/modules/SegmentColumn.test.jsx`
Expected: PASS.

- [ ] **Step 6: Register it**

In `builtins.js`, import `SegmentColumn` and add `['segment-column', SegmentColumn, { regions: ['right'] }]`.

- [ ] **Step 7: Run the full Surround suite**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/`
Expected: PASS, zero regressions.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentColumn.jsx \
        frontend/src/modules/Surround/modules/SegmentColumn.scss \
        frontend/src/modules/Surround/modules/SegmentColumn.test.jsx \
        frontend/src/modules/Surround/builtins.js \
        docs/reference/player/surround/design.md
git commit -m "feat(surround): SegmentColumn, the Act/Scene timeline as a vertical rail"
```

---

### Task 7: Author the academy definition and point the pilot play at it

The layout change is entirely here. No code branches on ratio — the corpus file names a different definition, and `YamlSurroundStore` resolves it by id.

**Files:**
- Create: `data/content/surround/_surrounds/playhouse-academy.yml` (data volume)
- Modify: `data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml` (data volume) — `surround: playhouse-academy`

**Interfaces:**
- Consumes: `segment-column` (Task 6), the `cue-ticker` column variant (Task 5), the widened slot declarations (Task 4), `collapse.mediaReserve` (Task 1).

- [ ] **Step 1: Write the academy definition**

`collapse.mediaReserve: 0` is the point of the layout: with the band gone from under the picture there is nothing to reserve, so the picture takes the whole column. At the living-room root with a 40% rail that is a 576×432 picture (against 482×362 under the band layout) — 27% more picture *and* a 67px wider rail.

```bash
cat > /tmp/playhouse-academy.yml <<'YAML'
# The academy playhouse: the playhouse surround transposed for a picture
# narrower than the screen.
#
# WHY A SECOND DEFINITION RATHER THAN A CONDITIONAL. Nothing in the frontend
# or the backend may branch on aspect ratio (see the drama spec's "No
# hardcoded structure vocabulary", and the same argument applies to shape).
# A corpus file names the presentation it wants; the store resolves it by id.
# So this is the whole layout change, and `playhouse.yml` is untouched for any
# work that still wants a band under its picture.
#
# THE TRANSPOSITION. A 4:3 picture in a 16:9 frame wastes WIDTH, not height —
# so the chrome goes where the room actually is. The rail carries the play's
# identity, the Act/Scene timeline and both listening registers; the picture
# takes the entire column; the work placard still floats on its top edge.
id: playhouse-academy
regions:
  top:
    module: work-placard
  right:
    - module: play-card
      width: "40%"
      side: left
    - { module: segment-column, height: fill }
    - module: cue-ticker
collapse:
  footerFloor: 90
  # NOTHING SITS UNDER THE PICTURE HERE, so nothing is reserved from it. The
  # cap resolves past the column and the media box takes min(100%, cap) = 100%.
  mediaReserve: 0
YAML
B64=$(base64 -w0 /tmp/playhouse-academy.yml)
sudo docker exec daylight-station sh -c "echo '$B64' | base64 -d > data/content/surround/_surrounds/playhouse-academy.yml"
sudo docker exec daylight-station sh -c 'wc -c data/content/surround/_surrounds/playhouse-academy.yml'
wc -c /tmp/playhouse-academy.yml
```

Expected: identical byte counts.

- [ ] **Step 2: Back up the sidecar, then point it at the new definition**

```bash
sudo docker exec daylight-station sh -c 'cat data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml' > /tmp/shrew.yml.bak
sed 's/^surround: playhouse$/surround: playhouse-academy/' /tmp/shrew.yml.bak > /tmp/shrew.yml
diff /tmp/shrew.yml.bak /tmp/shrew.yml
```

Expected: exactly one changed line. (`sed` is safe here because it rewrites a single scalar on one line and the result is diffed before it is written — the standing ban is on `sed -i` **in place** inside the container, which can mangle multi-line YAML.)

```bash
B64=$(base64 -w0 /tmp/shrew.yml)
sudo docker exec daylight-station sh -c "echo '$B64' | base64 -d > data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml"
sudo docker exec daylight-station sh -c 'wc -c data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml'
wc -c /tmp/shrew.yml
```

- [ ] **Step 3: Confirm the store resolves the new definition**

```bash
curl -s "http://localhost:3111/api/v1/play/plex:697661" | jq '.surround.id, .surround.definition.regions, .surround.definition.collapse'
```

Expected: `"playhouse-academy"`, a `right` list of three modules, and `{"footerFloor": 90, "mediaReserve": 0}`.

```bash
curl -s http://localhost:9428/select/logsql/query \
  -d 'query=context.app:surround AND _time:15m' -d 'limit=50'
```

Expected: no `surround.definition.missing`, no `surround.module.missing`, and — thanks to Task 4 — no `surround.module.misplaced`.

---

### Task 8: Measure the academy layout, and close the gate that let this ship

The closing gate is automated, because the last one was a manual eyeball and that is exactly why a missing band reached a television.

**Files:**
- Modify: `frontend/src/modules/Surround/band.measure.test.jsx` (an academy `describe`)
- Modify: `docs/reference/player/surround/design.md`

- [ ] **Step 1: Write the failing spec** — the academy arrangement, measured at all three fleet roots:

```js
describe('the academy layout, measured', () => {
  const ACADEMY_DEFINITION = Object.freeze({
    regions: {
      top: { module: 'work-placard' },
      right: [
        { module: 'play-card', width: '40%', side: 'left' },
        { module: 'segment-column', height: 'fill' },
        { module: 'cue-ticker' },
      ],
    },
    collapse: { footerFloor: 90, mediaReserve: 0 },
  });
  const ACADEMY = Object.freeze({
    ...EROICA_FULL,
    definition: ACADEMY_DEFINITION,
    piece: { ...EROICA_FULL.piece, aspectRatio: '4 / 3' },
  });

  it.each(FLEET)('$name — the picture takes the column and keeps its ratio', async ({ width, height }) => {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await layout(page, css, { width, height, data: ACADEMY });
    const b = await frameBoxes(page);
    await page.close();
    expect(b.media.w / b.media.h).toBeCloseTo(4 / 3, 2);
    expect(b.stage.h).toBeLessThanOrEqual(b.main.h);
    // The whole column, within the rounding the flex line introduces.
    expect(b.media.w).toBeGreaterThanOrEqual(b.main.w - 1);
  }, 120000);

  it.each(FLEET)('$name — every rail module has real height', async ({ width, height }) => {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await layout(page, css, { width, height, data: ACADEMY });
    const heights = await page.evaluate(() => [...document.querySelectorAll('.surround-frame__region--right')]
      .map((el) => ({ module: el.dataset.module, h: Math.round(el.getBoundingClientRect().height) })));
    await page.close();
    expect(heights).toHaveLength(3);
    heights.forEach(({ module, h }) => {
      expect(h, `${module} laid out at ${h}px — the academy rail collapsed a module`).toBeGreaterThan(40);
    });
  }, 120000);
});
```

- [ ] **Step 2: Run it and confirm it fails, then implement until green**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/band.measure.test.jsx -t "academy"`

- [ ] **Step 3: Full suite**

Run: `npx vitest run --reporter=default frontend/src/modules/Surround/`
Expected: PASS, zero regressions; the two pre-existing `it.fails` entries still expected-failing.

- [ ] **Step 4: Deploy and confirm on glass** — repeat Task 3's Steps 1–5 (gate, build, re-gate, deploy, headless measure, kiosk reload), with the headless script asserting the academy shape: three rail regions with real height, the picture at the column's width, and no bottom band.

- [ ] **Step 5: Document both layouts**

In `docs/reference/player/surround/design.md`, under the quality floor's aspect-ratio line, record: the media cap and why width is capped rather than height; that the reserve is `collapse.mediaReserve`, defaulting to `footerFloor`; and the academy layout as a second definition rather than a conditional.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Surround/band.measure.test.jsx docs/reference/player/surround/design.md
git commit -m "test(surround): measure the academy layout at every fleet root

The 4:3 defect was invisible to every check that ran — the unit test
asserted the inline aspect string, the modules logged healthy, and the only
thing that would have caught it was an optional manual eyeball at the end of
the plan. This measures the rendered boxes instead, in the standard suite."
```

---

## Self-Review

**Spec coverage.** The spec's §1 ("4:3 aspect ratio") had one unfulfilled clause — the sweep of `SurroundFrame.scss` for assumptions about the media box's shape, to be *confirmed against a real 4:3 render*. Task 1 fulfils it and converts it from a manual sweep into a standing measured spec. §2 (`PlayCard`), §3 (`PlaceCarousel`), §4 (character plumbing) shipped in the predecessor plan and are untouched here. The transposed layout is new work, not in the original spec; Task 6 Step 1 routes its visual grammar through brainstorming rather than inventing it in a plan.

**Placeholder scan.** Task 6 Steps 1 and 4 deliberately defer the vertical module's *visual grammar* to a brainstorming pass. That is a named decision with a named skill and a named output, not a "TBD" — the task's mechanism (reuse the solvers, replace the probe, observe height) is fully specified. Every other step carries runnable commands or literal code.

**Type consistency.** `--surround-media-cap-w` is spelled identically in `SurroundFrame.jsx`, `SurroundFrame.scss`, the harness emulation and every task that mentions it. `collapse.mediaReserve` is consistent across Tasks 1, 2, 7 and 8. The module name `segment-column` matches between `builtins.js` (Task 6 Step 6), the definition YAML (Task 7) and the spec's selector (Task 8). `frameBoxes` in Task 8 is the helper introduced by the 4:3 describe in Task 1 — both live in `band.measure.test.jsx`, so it is in scope.
