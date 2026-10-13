# Session-Detail Marker Gutter + Deep-Link Route

Date: 2026-06-09
Status: in progress

## Goal

Two changes to the fitness session-detail page (`FitnessSessionDetailWidget`):

1. **Center-gutter markers.** Today the challenge/video markers (icons + labels +
   indicator lines) sit crammed at the top of the bottom timeline section, and only
   the bottom (HR-area) chart shows indicators. Move the **icons + labels into a new
   gutter lane between the top line chart and the bottom area lanes**, and render the
   **vertical indicators on BOTH charts** so they emanate up (into the line chart) and
   down (into the area lanes) from the gutter. Challenges render as **translucent
   duration rectangles** (start→end), not point-in-time dotted lines. Distinguish
   challenge type AND zone: cycle (🚴 amber), HR-zone tinted by `zoneId`
   (warm `#ffd43b`, hot `#ff922b`) with the zone label.

2. **Deep-link route.** `/fitness/home/session-{sessionId}` opens the detail in the
   right-area on load, and clicking a session pushes that URL — so it is shareable.

## Data model (already merged via feature/dance-party)

Markers derive from `sessionData.timeline.events[]`:
- `type:"challenge"` → `start`, `end` (real duration), `result`, `requiredCount`,
  `zoneId`/`zoneLabel` (null = cycle, "warm"/"hot" = HR zone), persisted `data.type`.
- `type:"media"` → video; first = primary, 2..N = video changes (poster + title).

## Architecture

Each chart draws its OWN indicators (reuses the proven per-component X-alignment;
both use `effectiveTicks` + `CHART_MARGIN.left` + `plotWidth`). A single spanning
overlay is rejected — the line chart renders via `viewBox`/`preserveAspectRatio`
while the timeline renders in pixel width, so a shared overlay would risk drift.

Layout in `FitnessSessionDetailWidget`:
```
header (25%)
chart   → FitnessChart      (draws challenge rectangles + video lines, jut DOWN)
gutter  → new MarkerGutter  (icons + labels; the visual origin)
timeline→ FitnessTimeline   (draws challenge rectangles + video lines, jut UP)
```

### Steps

1. **Geometry** (`timelineOverlay.js`): `computeChallengeMarkers` also returns
   `xEnd`/`width` (from `e.data.end`, clamped; `end:null` → extend to axis end) and
   `zoneId`. TDD in `timelineOverlay.test.js`.
2. **Registry** (`challengeTypeRegistry.js`): zone color resolved by `zoneId` via
   `ZONE_COLOR_MAP` (warm/hot/…); keep cycle amber. Add `getChallengeMarkerColor(marker)`.
3. **MarkerGutter** component + SCSS: renders challenge chips (icon + count + zone
   label) and video cards at marker X; this is the only place labels live.
4. **FitnessTimeline**: challenge indicator → translucent rectangle (x..xEnd) instead
   of dotted line; remove the `.fitness-timeline__markers` label div (moved to gutter).
5. **FitnessChart**: render challenge rectangles + video dashed lines in `RaceChartSvg`
   overlay (currently only bands + seams).
6. **Shared X-scale**: compute marker geometry once in the widget and pass to chart +
   gutter + timeline so chips align with both charts' indicators.
7. **Router**: `FitnessScreenProvider.initialSelectedSessionId` from URL
   (`/fitness/home/session-{id}`); sessions-list click pushes the URL; back/clear pops it.

## Verification

- Unit: `timelineOverlay.test.js`, `challengeTypeRegistry.test.js` (zone color), gutter.
- Live: Playwright against `daylightlocal.kckern.net/fitness/home/session-20260608191948`
  (the warm/hot/cycle + Daytona video-change session) — screenshot + DOM check.
