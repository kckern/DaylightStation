# Piano Singalong (Karaoke) — UX & "AI Slop" Audit

- **Date:** 2026-07-11
- **Surface:** `https://daylightlocal.kckern.net/piano/singalong`
- **Method:** Visual audit of the live song-picker screen, cross-referenced to the source that renders it.
- **Lens:** A person walks up to the piano wanting to sing karaoke. What do they see, and what tells them this was thrown together by a machine rather than built for them?

---

## Where this screen lives in the code

The route is wired at `frontend/src/Apps/PianoApp.jsx:261`. Singalong does **not** have a bespoke picker — it reuses the generic **Videos** grid:

- `modes/Singalong/Singalong.jsx` → `<Videos source={config.singalong} PlayerComponent={SingalongPlayer} />`
- `modes/Videos/CourseGrid.jsx` → the category pill row (`.piano-course-tabs`) + the card grid
- `modes/Videos/CourseTile.jsx` → one card
- All styling in `frontend/src/Apps/PianoApp.scss` (tokens lines 14–56; grid + tabs lines 971–1132)

Tokens that matter here: `--piano-bg:#16161b`, `--piano-fg:#f1f1f4`, `--piano-muted:#9a9aa6`, `--piano-accent:#2ec46f`. Font is `Roboto Condensed` everywhere. Category labels and song data come from the backend piano config (`singalong.collections[].label`) + Plex, not from frontend source.

> **Discrepancy to resolve first.** The code renders a **poster wall** (`.piano-video-grid--posters`, `aspect-ratio: 2/3` cover art). The live screen renders **text-only cards** — no artwork at all. Either these Plex items have no posters (so every tile falls back to text) or a different variant is in play. Whichever it is, the karaoke user is looking at a wall of gray rectangles with no imagery, which drives half the problems below. Confirm which path is live before building fixes.

---

## TL;DR

This screen is a competent generic content grid that has been pointed at songs. It is not a karaoke picker. The single loudest problem isn't a color or a font — it's that **the taxonomy was invented by an LLM and doesn't match how any human chooses a karaoke song.** Everything else (the charcoal-plus-one-green palette, the tiny green uppercase captions, the redundant breadcrumb) is surface AI-slop that compounds the feeling.

---

## Part 1 — The AI slop tells

These are the specific markers that read as "an LLM generated this," in rough order of how loudly they announce themselves.

### 1. The invented, overlapping category names (the biggest tell)

> Crooners & Standards · Piano Men · Stage & Screen · Emotional Ballads · Arena Power Ballads · Epic Anthems · Anthems of Hope · Sing-Along Crowd-Pleasers · Pop Throwbacks · TV Themes

This is a machine's idea of genres, not a music library's. The tells:

- **Clever over clear.** "Anthems of Hope," "Arena Power Ballads," "Epic Anthems," and "Sing-Along Crowd-Pleasers" are four buckets that a person cannot tell apart. Which one holds "Don't Stop Believin'"? (It's filed under Arena Power Ballads. "Africa" is Sing-Along Crowd-Pleasers. Both are the same thing to a human.) When categories aren't mutually predictable, the filter is decorative.
- **The rule-of-three / adjective-noun cadence.** "X & Standards," "X Power Ballads," "X Anthems," "X Throwbacks," "X Crowd-Pleasers" — the naming pattern is an LLM tic, ampersands and all.
- **Mixed axes in one row.** Some are by artist archetype ("Piano Men"), some by source ("Stage & Screen," "TV Themes"), some by mood ("Emotional Ballads," "Anthems of Hope"), some by venue vibe ("Arena Power Ballads"). A person can't hold a heterogeneous taxonomy in their head, so they fall back to search — which means the whole tab row is dead weight.

### 2. Charcoal background + a single acid-green accent

`#16161b` with exactly one bright green (`#2ec46f`) is, verbatim, one of the three default looks that current AI design converges on. It isn't *wrong*, but nothing on the screen earns it — the green isn't reserved for "the thing you press," it's sprayed onto every category caption, so it reads as theme rather than meaning.

### 3. The tiny green uppercase micro-label

`STAGE & SCREEN` in small-caps accent green under each song is the template "eyebrow." It's the single most over-produced element in AI UI right now, and here it's the *most visually prominent thing on each card* (see hierarchy problem below) despite being the least useful.

### 4. Redundant breadcrumb: `Karaoke › Karaoke`

The trail repeats the same word. A breadcrumb that says the same thing twice is a dead giveaway that segments are being concatenated mechanically (mode label + collection label happen to match) with no one reading the result.

### 5. Uniform, undifferentiated card wall

Every card is the same rounded rectangle, same border, same padding, same weight. Real catalogs earn visual rhythm (art, color, size, badges). A perfectly even gray grid is what you get when a generic `CourseTile` is asked to render anything.

### 6. Ellipsis-placeholder + ghost-pill filter row

"Search songs or artists…" (with the … glyph) over a row of one filled pill + ghost outline pills is the stock component pairing. Fine in isolation; part of the pattern in aggregate.

---

## Part 2 — UX problems, from the karaoke-picker's chair

The user's actual job: *find a song I know and can sing, fast, ideally without typing.* Ranked by how much each one hurts that job.

### A. The taxonomy doesn't match how people pick karaoke songs — CRITICAL

People choose by **artist**, **decade**, **"do I actually know this one,"** **popularity/"what kills the room,"** and sometimes **difficulty/range**. They do *not* think "I'm in an Anthems-of-Hope mood." The mood-bucket tabs answer a question nobody asked while omitting the axes people actually use. Net effect: the filter row looks helpful and is nearly useless, so everyone defaults to scanning A→Z or searching.

### B. No artwork / no recognition surface — CRITICAL

A wall of text forces *reading* every title. Album/artist art lets people *recognize* at a glance, which is how humans scan a song list. Whether the missing art is a config gap or a design choice, the result is the slowest possible scanning mode for a browse-heavy task.

### C. Wrong information hierarchy on the card

Visual weight order right now: **Title (bold white) → green category caption → artist (muted gray).** The green caption pulls the eye *before* the artist. But for karaoke the priority is **Title → Artist → (maybe) anything else.** The one field a singer cares about second (who sang it, so they know the tune) is the dimmest thing on the card, and the field they care about least (a fuzzy mood bucket) is the brightest. Fix the hierarchy: demote the category to muted gray or drop it from the card entirely (it's redundant once you're inside a filtered tab), promote the artist.

### D. Alphabetical-by-title sort produces nonsense ordering

Sorting on raw title means "**(Everything I Do)** I Do It for You" sorts to the very top under `(`, and leading articles ("A Whole New World," "As Long as…") aren't normalized. A person hunting for that Bryan Adams song looks under B (artist) or E (Everything) — not `(`. At minimum strip leading articles/parentheticals for sort; better, offer **sort by artist**.

### E. The filter row overflows with no affordance

Eleven categories in a single non-wrapping row — "TV Themes" is clipped at the right edge in the screenshot. There's no chevron, fade, or "more" cue telling the user the row scrolls. Hidden categories are functionally invisible.

### F. Missing the affordances a karaoke session actually needs

None of these are present, and every one is table-stakes for singing with other people:
- **A queue / "next up"** — karaoke is a turn-taking group activity; there's nowhere to line up songs.
- **Favorites / "my songs"** — people sing the same 10 songs; make those one tap away.
- **Recently played / popular** — the single best default view for a walk-up user.
- **Key / difficulty / "has lyrics track"** — no signal about whether a song is singable or even has a karaoke track.
- **Preview** — no way to confirm "is this the version I'm thinking of."

### G. Tap affordance is ambiguous

Nothing on the card signals it's pressable — no play glyph, no hover/press state visible, no "tap to sing." For a walk-up wall-mounted piano kiosk (touch, no cursor), the absence of an obvious primary action per card is a real friction point.

### H. Header chrome is tuned for the wrong user

The top-right shows a **"Acoustic Grand"** voice/instrument selector with equal prominence to the user chip. A person picking a karaoke song does not care which piano *voice* is loaded — that's a performer/setup concern, not a song-picker concern. It competes for attention in the exact corner where a **queue count** or **"now singing"** indicator would belong.

### I. Low information density

Roughly 28 songs fill the entire viewport. For a catalog of hundreds, that's a lot of scrolling to browse. Because the cards carry only three short text fields, the generous card size buys no extra information — it's whitespace, not breathing room. Denser rows (or a list mode) would let people see more of what they came to find.

### J. Ragged grid from variable title length

Titles wrap to 1–3 lines ("(Everything I Do)…", "As Long as We Got Each Other," "Can't Smile Without You"), so card heights and the bottom edge of each row are uneven. It reads as unpolished. Fix with a consistent card min-height or a clamped title.

### K. Accessibility / contrast

- `--piano-muted:#9a9aa6` on `#16161b` (artist text, ghost-pill labels) is low-contrast — borderline for small text.
- The small green captions (`#2ec46f` at ~0.7rem) are decorative-sized; verify they clear WCAG AA for the size, and don't rely on green alone to carry meaning.
- Confirm keyboard focus and touch target sizes (kiosk is a touch surface).

---

## Part 3 — Recommendations, prioritized

### P0 — Fix the model, not the paint

1. **Replace the invented taxonomy with axes people actually use.** Lead with **Artist** and **Decade** browse, plus **Popular** and **Favorites/Recent**. If mood buckets stay at all, cut them to 3–4 unambiguous ones and rename in plain terms. Remove overlapping cleverness ("Epic Anthems" vs "Arena Power Ballads" vs "Anthems of Hope" → pick one).
2. **Make search the hero.** For a known-item task on a touch kiosk, the search box is the primary tool — give it top billing, keep it sticky on scroll, and make sure it searches title *and* artist (the placeholder promises artists; verify it delivers).
3. **Add artwork** (or, if none exists, a deliberate typographic tile with real hierarchy) so scanning becomes recognition.

### P1 — Fix the card and the sort

4. **Re-rank the card:** Title → **Artist (promoted)** → drop or mute the category caption. Add a clear "tap to sing" / play affordance.
5. **Normalize sort:** strip leading articles/parentheticals; offer **sort by artist**.
6. **Consistent card height** to kill the ragged grid.

### P2 — Make it a karaoke tool

7. Add a **queue / up-next**, **favorites**, and **recently/most sung**.
8. Surface **has-lyrics** and (if known) **key/range** so people don't pick unsingable songs.
9. Move the **instrument-voice selector** out of the picker's prime real estate; put a queue/now-singing indicator there instead.
10. Give the **overflow filter row** a scroll affordance, or wrap it.

### P3 — De-slop the surface (respecting existing canon)

- **Keep Roboto Condensed** (it's the house font — get "bold" from weight, color, and motion, not a new typeface) and **keep the green** — but **reserve the green for action/selection only** (the pressable thing, the active tab, the play state), not decorative captions. That single change does more to shed the "template" feel than any repaint.
- **Fix the breadcrumb** so it never renders `X › X`.
- Reduce per-card whitespace to raise density; consider a **list view** toggle for fast known-item scanning.

---

## Implementation status (2026-07-11, shipped `9b1f24885`)

The **purpose-built Karaoke browser** (`modes/Karaoke/`) — not the generic Videos
grid this audit was written against — is now the live singalong/play-along picker,
and the de-slop recommendations that don't require new data are shipped:

**Done**
- **P0.2 Search is the hero** — sticky search toolbar (stays on scroll); searches title + artist.
- **P0.3 Recognition art** — every song gets the canonical `MaterialGlyph` identicon
  (deterministic FNV-1a → symmetric SVG) on a **category-tinted tile**. No more wall of gray text.
- **P1.4 Card re-rank** — Title → promoted Artist → demoted muted category (color-dot, not green
  eyebrow); hover/focus ▶ "tap to sing" affordance.
- **P1.5 Sort** — `sortKey` strips leading articles/parentheticals; **Song/Artist** segmented toggle
  (artistless rows sink, tie-break on song).
- **P1.6 / J Consistent card height** — fixed height + 2-line title clamp kills the ragged grid.
- **P2.10 Filter overflow** — tab row wraps (no clipped "TV Themes").
- **P3 De-slop** — green reserved for action/selection only (categories carry their own stable hue via
  `categoryHue`); breadcrumb `Karaoke › Karaoke` doubling fixed (empty crumb; chrome shows the mode).

**Deferred — blocked on data/infra that doesn't exist yet (net-new features, not slop fixes)**
- **P0.1 Replace the taxonomy with Decade / Popular / Recent** — the categories ARE the Plex seasons
  (a data restructure, not frontend); Decade needs per-song year metadata, Popular/Recent need play
  history wired to this surface. Artist axis is shipped (sort); the rest is a data project.
- **P2.7 Queue / favorites / recently-sung** — no karaoke-song queue or per-song favorites store exists
  (the preset "favorites" are VOICES, not songs).
- **P2.8 has-lyrics / key / range** — not present in the Plex metadata for these covers.
- **P2.9 Move the voice selector out of the chrome** — the sound chip is core piano chrome, not
  picker-only; left as-is pending a broader chrome decision.
- **P2 Preview** and **P3 list-view toggle** — not built this pass.

These are scoping decisions, not oversights: each deferred item needs a data source or a new
subsystem, and should be its own spec.

## One-line verdict

The screen isn't ugly — it's *generic*, and the genericness runs deeper than the palette: it's a general-purpose content grid wearing LLM-generated genre names, optimized for even spacing instead of for a person who walked up to sing a specific song. Fix the taxonomy and the search-first flow, reserve the green for actions, promote the artist, and it stops looking like something a machine assembled and starts looking like a karaoke machine someone built.
