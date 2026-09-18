# Drama Nav Rail — Act / Scene / Beat Navigation

**Date:** 2026-09-17
**Status:** design, awaiting review
**Supersedes the rail half of:** [2026-09-16-drama-surround-design.md](./2026-09-16-drama-surround-design.md)
**Surround definition affected:** `playhouse-rail` (4:3 works). `concert-hall` and `playhouse` are untouched.

---

## 1. Goal

Turn the 4:3 drama rail from a caption block into a **navigation surface**: a horizontal
Act header over a two-level Scene → Beat accordion, operable by pointer *and* by the
Shield remote, with progress readable at every level.

## 2. Why — what the shipped rail got wrong

The shipped `playhouse-rail` answers none of the viewer's questions. Measured against
`concert-hall`, the diagnosis is not "too small" but **two jobs in one box**:

| | concert-hall (works) | playhouse-rail (shipped) |
|---|---|---|
| rail | `316.8 × 540`, identity only — composer, place | identity **and** position, in 384px |
| position | its own thin **64px** strip (`segment-map`) | a 14-row list inside the rail |
| prose | its own strip beneath it (`cue-ticker`, 57px) | squeezed into the same column |

Classical's rule is **one job per zone, and position is a map — never a list, never
sharing a box with prose**. This design restores that rule and spends the recovered
space on navigation.

The 4:3 geometry pays for it: a 576-wide picture is 432 tall in a 540 column, leaving
**108px of unused height** under the picture — where `playhouse.yml` already puts its band.

## 3. Decisions taken

| # | Decision | Source |
|---|---|---|
| 1 | Horizontal Act header over the side rail (not a full-height vertical tree) | user |
| 2 | Beats become the **segments**; scenes become groups | user |
| 3 | Act chips show progress as a **fill**, not a crawling dot | recommended, accepted |
| 4 | Accordion overflow: **compress to the legibility floor, then auto-scroll** | decided here (§9) |
| 5 | Pointer **and** remote from day one | user |
| 6 | Scene names and act titles are **invented** — the Folio's are stage directions | user |
| 7 | Placard centered above the picture, house style, ~50% overlap | user |

### Rejected, with reasons

- **Crawling dot on the chips.** `SegmentMap.jsx:20-31` records that a lit/glowing
  playhead tip was built and removed: *"the glowing tip read as a worm crawling the
  band, and once the fill carries the progress the cursor has nothing left to prove."*
  Reintroducing it would re-litigate a settled call. Fill is the house language.
- **`cues:` as the beat mechanism.** A `cues:` layer already exists (5 corpus files,
  `{ at, render, text }`, fanned by `noteCues()` at `YamlSurroundStore.mjs:185-227`),
  but **a cue is a point, not a span** — no duration means no progress bar and nothing
  to expand. Beats need spans.
- **A vertical full-height tree.** Viable, but costlier: the column deliberately skips
  the group machinery the horizontal rail already has.

## 4. The hierarchy is data, and the store already supports it

Act → Scene → Beat is a third `groups:` level in the **work body**, not a code change.
`YamlSurroundStore.mjs:95-118` walks groups recursively with no depth bound, and
`:793-798` carries the whole ancestry in `groupPath` (outermost first) precisely because
a three-deep segment used to lose its outer group silently.

This is already proven by an existing test — `YamlSurroundStore.test.mjs:1707-1722`
asserts a three-level `act → scene → dance` corpus flattens with the full path intact:

```yaml
- { kind: act, title: Act I, facts: [...], groups:
    [{ kind: scene, title: The garden, facts: [...], groups:
      [{ kind: dance, title: Pas de deux, facts: [...], segments: [{ n: 1, name: Opening }] }] }] }
```

**No backend work is required for the hierarchy.** `kind: beat` is a word the code never
reads — the same discipline that keeps `act`/`scene`/`movement` out of the JSX.

### Consequence: beats are the segments

Segments are leaves. With beats present:

- a **beat** is a segment, with its own start
- a **scene** is a group; its span is first-beat-start → last-beat-end
- the sidecar's `starts:` grows from **14 entries to ~60–85**
- `segmentNav.js` (`useMediaKeyboardHandler.js:213, :255`, bound to `Tab`/`Backspace`)
  begins stepping by **beat** rather than by scene. Moot on the Shield — neither key
  exists there — but a real behaviour change on a keyboard. Accepted.

## 5. Layout and geometry (960 × 540 living-room root)

```
        ┌──────── placard (centered, straddling) ────────┐
┌───────┴───────────────────────────────┬───────────────┴───┐
│                                       │  act chips        │  84
│         picture  576 × 432            ├───────────────────┤
│                                       │  Act IV · The …   │  44   ← one line
│                                       ├───────────────────┤
│                                       │  scene accordion  │ 262
├───────────────────────────────────────┤   ▸ scenes        │
│  band 576 × 86  (enrichment)          │   ▾ active scene  │
└───────────────────────────────────────┤     └ beats       │
                                        ├───────────────────┤
                                        │  who's-who card   │ 150
                                        └───────────────────┘
                                             rail 384 × 540
```

The placard costs 22px of column height at 50% overlap, so the band is **86**, not 108.
`mediaReserve` stays **108** — it is only split differently.

### The definition

```yaml
id: playhouse-rail
regions:
  top: { module: work-placard }
  right:
    - { module: segment-map, width: "40%", orientation: column,
        groups: header, scope: group, height: fill }
    - { module: play-card, identity: false, height: 150 }
  bottom:
    - { module: cue-ticker, height: fill }
collapse:
  footerFloor: 90
  mediaReserve: 108
```

Region keys are abstract (`groups: header`, `scope: group`) — no domain vocabulary.

## 6. The rail

**Act chips.** One per **placed** group. Both Induction scenes are `null` in this
production (cut by Miller), so the Induction has no seekable segment and gets **no
chip** — five chips, Acts I–V. Chips are built from placed groups, never authored count.

**Heading.** Number and title on one line: `Act IV · The Taming`.

**Scene → Beat accordion.** Scenes of the selected act list vertically; the sounding
scene expands to its beats and collapses when the playhead leaves it. Precedent exists:
`--accordion-ms` / `--group-rows` (`SegmentMap.jsx:1382-1393`) with the playhead
transition dropped to `0ms` during the 420ms accordion so there is never a second clock.

**Who's-who** stays pinned at the foot, via `play-card` with a new `identity: false`
flag — the mirror of the existing `facts: false` — so the title is not reprinted under
the placard that already carries it.

## 7. Progress language

Reuse the house language exactly; invent nothing.

- Per-item **fill**: 2px `--ink` over `--ink-soft`, widening to 4px `--brass` on the
  sounding item (`SegmentMap.scss:825-834`, `:847-857`, `:902-905`).
- One 2px `--brass-lit` hairline cursor. **Nothing glows; no gradients; no radius.**
- All motion `120ms linear`, by `transform`, never `left`/`width`.

Applied at three levels: **act chip**, **scene row**, **beat row** — each carrying its
own `--fill`, computed as the fraction of *that item*, which is why the accordion cannot
desynchronise it (`SegmentMap.jsx:1666-1670`).

**This is new work in column mode.** Today `orientation: column` rows carry no fill at
all — only `data-state="played|ahead|sounding"` as opacity, with progress living
entirely on the spine (`SegmentMap.jsx:1295-1300`). The horizontal `__bar` / `__bar-fill`
pattern is ported into rows; it is a proven pattern, not a new one.

## 8. Placard

Already centered (`WorkPlacard.scss:20`) and already straddling the picture's top edge
via `--placard-inset: 4.2rem` and `--placard-straddle: -66.67%`
(`SurroundFrame.scss:331-351`). House style is a brass plaque: `#18181a` under
`brass.jpg`, engraved-silver `#b9bcc6` italic Cormorant Garamond title, small-caps meta,
no border and no radius (two inset hairlines), and the one element in the frame allowed
a drop shadow.

**Only change:** `--placard-straddle: -66.67%` → `-50%` for an even 50% overlap.

## 9. Accordion overflow — compress, then auto-scroll

Beat rows shrink to the existing floor (`min-height: calc(var(--label-floor) * 2)`,
`SegmentMap.scss:1150-1177`) and **no further** — that floor is the ten-foot contract
the whole surround is built on. The current `max-height: 4 × --label-floor` cap is
lifted so rows can also *grow* into a short list.

Past the floor, the beat list scrolls itself to keep the sounding beat visible (or, in
nav mode, the selected one). This needs no new input — it follows the playhead.

> **Measured 2026-09-17, live at the 960 root:** `--label-floor` resolves to **8.64px**
> (inline and computed agree), so a beat row floors at `2 × 8.64 = 17.28px`. Against the
> 262px accordion that is **~15 rows** to share between the scene rows and the open
> scene's beats: **6 beats** with 32px scene rows, **~8** at 24px, **~10** with
> everything at the floor. Seven beats per scene fits without scrolling — auto-scroll is
> the safety valve, not the normal case.

## 10. Input

### Pointer — mostly already built

Column rows already carry `onClick → seekTo()` (`SegmentMap.jsx:1353`), which dispatches
a `surround-seek` CustomEvent (`:196-203`) caught by `SurroundHost.jsx:102-120` and
turned into a real seek. Chips and beat rows gain the same. The module contract stays
read-only — the seek travels out-of-band, never as a prop (`SurroundFrame.jsx:219-221`).

### Remote — new, and constrained to four keys

The Shield offers **D-pad + OK** only; `Esc` is swallowed by FKB. The Player already owns
all four (`keyboardConfig.js`): arrows seek / cycle shaders, `Enter` toggles play.

| Key | Playing | In nav mode |
|---|---|---|
| Down | **enters nav mode** at the sounding beat | next beat |
| Up | unchanged | previous beat; past the top, **exits** |
| Left / Right | seek (unchanged) | previous / next act, **previewing** it |
| OK | play/pause (unchanged) | **seeks** to selection, then exits |
| — | — | idle grace also exits |

- `ArrowDown` is reclaimed from `cycleShadersDown` **only** on works whose definition
  declares a nav rail. Shader cycling is untouched everywhere else.
- **No state depends on `Esc`.** Every state exits with D-pad + OK alone.
- Previewing never seeks. Nothing moves until OK.
- Selection reaches the module by an inbound `surround-nav` CustomEvent — the mirror of
  the outbound `surround-seek` — so the read-only module contract is preserved.
- `useScopedRemoteControls` is **not** used: it only roves `button`/`a[href]`/`input`,
  and it would fight the Player for the same keys.

## 11. Data authoring

Beat text comes from `The Taming of the Shrew (Cliffs Complete).pdf` (beside the media)
or the Calibre edition in `archives/`. Timings come from the SRT at
`/media/kckern/Media/TV Shows/Shakespeare/Season 1/…​.srt` — **2147 cues**, verified
readable directly by the `claude` user, cue 2 at `00:00:41,060` matching the sidecar's
own anchor comment.

The SRT is **ASR and noisy** (`"Trollio!"` for *Tranio*): it supplies *where*, never
*what*. It is an authoring aid only — beats ship as static YAML timestamps, so no
subtitle parsing is needed in `backend/` or `frontend/`, and the fact that `TV Shows/`
is unmounted in the container is irrelevant. (`parseSrt` exists at
`cli/contentfilter.cli.mjs:550` if snapping is ever automated.)

To author: **5 act titles**, **12 scene names**, **~60–85 beats** (name + start).

## 12. Invariants

1. **No use-case vocabulary in code.** `act`, `scene`, `beat` appear only as data.
2. **`concert-hall` renders byte-identical.** It declares none of the new region flags.
3. **The module contract is unchanged** — `{ position, duration, playing, seeking, data,
   region, logger }`. Both seek and nav travel as DOM events.
4. **Nothing below `--label-floor`.**
5. **No new glow, gradient, or radius.**
6. **A band holding a nested `segment-map` is structurally ≥82px.**
   `SegmentMap.scss:130` sets `min-height: calc(3.9rem + var(--group-rows))`, which
   overrides any authored `height` — an authored height is only a flex basis. The
   nav-rail band therefore carries the **ticker alone**; the Act/Scene map lives in the
   rail. Ignoring this is what leaves a ticker too short to set anything.

## 13. Testing

- Store: a three-level fixture already exists; add one asserting a scene's span derives
  from its beats, and that an unplaced group yields no chip.
- `SegmentMap`: chips from placed groups only; accordion expands the sounding scene;
  per-row `--fill`; rows honour the floor; auto-scroll keeps the sounding beat visible.
- Input: each key in both modes; every state exits without `Esc`; preview does not seek.
- Regression: `concert-hall` compiled CSS and layout unchanged.
- Measurement: live geometry at the 960 root — picture exactly 4:3, band 86, no overflow.

## 14. Risks

| Risk | Handling |
|---|---|
| ~~Band prose may not fit~~ — **measured, resolved** (§15) | **Single register at full width.** Two registers are abandoned: at 288px the two longest act facts overflow. |
| Authoring ~60–85 beats is the bulk of the effort | Bounded and mechanical; sources identified. |
| Reclaiming `ArrowDown` surprises a keyboard user | Scoped to nav-rail definitions only. |
| ~~Visible-beat count estimated~~ — **measured, resolved** (§9, §15) | Floor confirmed live at 8.64px. |

---

## 15. Measurements (2026-09-17, live at the 960 root)

Taken against the running app, not derived. Recorded so they are not re-derived — and
so their limits are known.

| Quantity | Value | How |
|---|---|---|
| `--label-floor` | **8.64px** | published inline by the frame; inline and computed agree |
| beat row floor | **17.28px** | `2 × --label-floor` (`SegmentMap.scss:1165`) |
| current column row height | 28.58px, 11 rows in a 320px region | live render |
| `segment-map` min-height, nested | **82px** | `3.9rem + --group-rows` (`SegmentMap.scss:130`) |
| ticker band needed @482px wide | 62px for 351 chars (4 lines); 49px for 320 (3); 36px for ≤203 (2) | injected probe at the prose floor |
| ticker band @576 × 86, sole occupant | **every corpus note fits** — worst case 3 lines / 39px of 76px usable | same probe |

**The probe is a lower bound, not the ladder.** It measures plain text reflow at the
10.56px prose floor (`14.08 × 0.75`). The real `fitBand()` also honours leading and
ceiling constraints and refuses more readily. Evidence: at the interim `482 × 40` the
probe predicted three of six notes would set, yet the live ticker rendered **empty**.
Treat these as "no smaller than", and measure the real ladder before trusting a tight fit.

### Interim live state

The Shrew's sidecar was switched from `playhouse-rail` to **`playhouse`** on 2026-09-17
while this design is built — restoring a working 121.3px band with an 11-segment
Act/Scene map and a rail carrying identity and rotating character cards. Its ticker
region (40px) renders empty for the reason above; the dead strip is **known and
deliberately accepted** for the interim rather than papered over.
