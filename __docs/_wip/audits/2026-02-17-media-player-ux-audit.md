# Media Player UX Audit

**Files:** `frontend/src/modules/Feed/Scroll/cards/bodies/MediaBody.jsx`, `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx`
**Related:** `Scroll.scss` (mini bar styles), `DetailView.jsx`, `PlayerSection.jsx`, `FeedCard.jsx`
**Date:** 2026-02-17

---

## Executive Summary

MediaBody and FeedPlayerMiniBar are minimal implementations that deliver basic functionality but miss several UX best practices for media consumption. The card body duplicates source identity already shown by the card's source bar, the detail view presents a large empty void below sparse metadata, and the mini bar provides no playback controls or progress feedback — it functions as a notification banner rather than a persistent player. These issues reduce the feed's perceived polish and make media items feel like second-class content compared to headlines and journal entries.

**Verdict:** Functional but underbuilt. Several quick wins available; deeper improvements require new props/state plumbing.

---

## Card Body Issues

### C1. Redundant source badge

MediaBody renders an amber "PLEX" badge (lines 7-18), but FeedCard already renders a source bar with the same label directly above it. The user sees "PLEX" twice stacked vertically.

**Best practice:** Don't repeat information visible in the same viewport. The card's source bar already communicates provenance.

**Fix:** Remove the badge. Use the freed vertical space for richer content (media type, duration, year).

---

### C2. No media metadata on card

The card body shows only title and an optional subtitle. For media items, users benefit from at-a-glance metadata: media type (movie, album, episode), duration, year, or genre. Other body components (GratitudeBody, JournalBody) show content-specific details — MediaBody should too.

**Best practice:** Show the most decision-relevant metadata on the card so users can triage without opening the detail view.

**Fix:** Display `item.meta.type` (e.g., "Movie", "Album") and any available duration/year from `item.meta`.

---

### C3. All inline styles

MediaBody uses inline `style={{}}` objects for every element. While other body components do the same, this prevents hover states, focus indicators, media queries, and CSS class reuse. It also makes the component harder to theme.

**Best practice:** Use CSS classes (via SCSS module or shared stylesheet) for layout and theming. Inline styles should be reserved for truly dynamic values.

**Fix:** Low priority — systemic issue across all body components. Address when establishing a body component style system.

---

### C4. No play affordance on card body

The hero image in FeedCard shows a play overlay triangle, which is good. But if the hero image fails to load or is absent, there's no visual cue that this item is playable. The body itself has no play icon or indicator.

**Best practice:** Playable items should have a persistent play affordance that doesn't depend on the hero image loading.

**Fix:** Add a small play icon (▶) next to the title or in the badge area when `item.source === 'plex'`.

---

## Detail View Issues

### D1. Vast empty space below metadata

The detail view for Plex items shows: source bar, hero image, title, date, "Open in browser" button, "Play" button, and a single "TYPE: album" metadata line. Below that is a large empty void filling the rest of the viewport. Screenshots confirm this — the bottom 60% of the detail panel is blank.

**Best practice:** Detail views should fill available space with useful content or constrain their height to match content. Empty space signals an unfinished UI.

**Fix:** Options ranked by impact:
1. Show a description/summary if available from Plex metadata (`item.body`)
2. Show additional metadata (genre, year, studio, rating, duration)
3. If no additional content exists, constrain the detail panel height to fit content rather than stretching to full viewport

---

### D2. "TYPE: album" presentation

The metadata line shows `TYPE: album` as raw key-value text. This feels like debug output rather than polished UI.

**Best practice:** Format metadata with human-friendly labels and visual hierarchy.

**Fix:** Render as a styled chip or formatted label (e.g., "Album" with an icon) rather than `TYPE: album`.

---

### D3. No description or synopsis

Movie and TV items from Plex typically have summaries/synopses. If the Plex adapter provides `item.body` or `item.meta.summary`, the detail view should render it. Currently the BodySection exists in the section registry but may not be receiving content.

**Best practice:** Detail views should tell users enough to make a consumption decision.

**Fix:** Verify whether the Plex adapter sends description data. If available, ensure BodySection renders it.

---

## Mini Bar Issues

### M1. No playback controls

The mini bar shows source name, title, and a close button. There are no play/pause, skip, or volume controls. Users must tap the bar to open the detail view, then use controls there. This adds friction to the most common media interaction (pause/resume).

**Best practice:** Persistent mini players (Spotify, Apple Music, YouTube Music) always include at minimum a play/pause toggle.

**Fix:** Add a play/pause button to the mini bar. This requires `activeMedia` to include playback state or a ref to the player instance.

**Effort:** Medium — requires state plumbing from Player component through Scroll.jsx.

---

### M2. No progress indication

Users have no way to see how far into the media they are without opening the detail view. A thin progress bar below the mini bar is a standard pattern.

**Best practice:** Show playback progress to give users temporal context.

**Fix:** Add a progress bar (thin line at the top or bottom of the mini bar). Requires current time / duration data from the player.

**Effort:** Medium — same state plumbing as M1.

---

### M3. No thumbnail

The mini bar is text-only. A small album art / movie poster thumbnail on the left side provides instant visual recognition and aligns with every major streaming app's mini player pattern.

**Best practice:** Include a visual identifier (thumbnail) in persistent media controls.

**Fix:** Render `item.image` as a small square thumbnail (e.g., 40x40px) on the left side of the mini bar.

**Effort:** Low — `item.image` is already available, just needs rendering + SCSS.

---

### M4. Close button has no hover/focus feedback

`.feed-mini-bar-close` in Scroll.scss has no `:hover` or `:focus` styles. The button doesn't visually respond to interaction.

**Best practice:** All interactive elements must provide visual feedback on hover and focus (WCAG 2.1 SC 2.4.7).

**Fix:** Add `opacity`, `background-color`, or `transform` on `:hover` and `:focus-visible`.

**Effort:** Trivial — CSS-only change.

---

### M5. No swipe-to-dismiss

On mobile, users expect to be able to swipe away persistent bottom bars. Currently the only dismissal mechanism is the small × button.

**Best practice:** Support gesture-based dismissal on touch devices.

**Fix:** Low priority. Would require a touch event handler or a library like `react-swipeable`.

---

## Accessibility Issues

### A1. Mini bar has no ARIA role

The mini bar's outer `<div>` has no `role` or `aria-label`. Screen readers can't identify it as a media control region.

**Fix:** Add `role="region"` and `aria-label="Now playing"` to the outer div.

---

### A2. Mini bar click target is the entire div

The entire mini bar div has an `onClick={onOpen}` handler, but it's not keyboard-accessible (no `tabIndex`, no `onKeyDown`). Keyboard users can reach the close button but not the "open detail" action.

**Fix:** Add `tabIndex={0}`, `role="button"`, `aria-label="Open now playing"`, and `onKeyDown` handler for Enter/Space.

---

## Recommendations

### R1. Remove redundant PLEX badge from MediaBody (quick fix)

Remove the badge `<div>` and use the space for media type/metadata. Card source bar already shows the source.

---

### R2. Add thumbnail to mini bar (quick fix)

Render `item.image` as a 40x40px square on the left. Proven pattern from Spotify/YouTube/Apple Music.

---

### R3. Add hover state to close button (quick fix)

Add `:hover` and `:focus-visible` styles to `.feed-mini-bar-close` in Scroll.scss.

---

### R4. Add ARIA attributes to mini bar (quick fix)

Add `role="region"`, `aria-label`, `tabIndex`, and keyboard handler to the mini bar.

---

### R5. Show media metadata on card (medium effort)

Display type, duration, or year from `item.meta` in MediaBody to help users triage without opening detail.

---

### R6. Add play/pause to mini bar (medium effort)

Requires player state to flow through `activeMedia` or a shared ref. Most impactful UX improvement for media consumers.

---

### R7. Add progress bar to mini bar (medium effort)

Thin progress indicator showing current position / total duration. Can be implemented alongside R6 since they share the same state plumbing.

---

### R8. Fill detail view empty space (medium effort)

Show description/synopsis, additional metadata, or constrain panel height. Check if Plex adapter provides richer data.

---

## Priority Matrix

| Fix | Effort | Impact | Priority |
|-----|--------|--------|----------|
| R1. Remove redundant badge | 5 min | Visual clarity | Now |
| R2. Add mini bar thumbnail | 15 min | Visual polish | Now |
| R3. Close button hover state | 5 min | Accessibility | Now |
| R4. ARIA attributes | 10 min | Accessibility | Now |
| R5. Media metadata on card | 20 min | Information density | Soon |
| R8. Fill detail view space | 30 min | Perceived completeness | Soon |
| R6. Play/pause on mini bar | 1-2 hours | Core media UX | Before v1 |
| R7. Progress bar on mini bar | 1 hour | Core media UX | With R6 |
| M5. Swipe to dismiss | 30 min | Mobile UX | Nice to have |
| C3. Extract inline styles | 1 hour | Maintainability | When systemic |
