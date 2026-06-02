# Cycle Game Frontend Design Audit — 2026-06-02

Top-to-bottom review of the cycle-game UI. The lobby had received heavy polish
(~500 lines of SCSS); everything **beyond the lobby** was barebones (12–30 lines
each) and read as debug-grade "slop." This audit drove the "Velodrome Broadcast
HUD" redesign of the post-lobby screens.

## Findings

### Countdown (`CountdownStoplight`)
- Static flat lamp circles + a plain `4rem` number; no motion, no anticipation.
- **Fix:** pulsing accent ring, per-count scale-punch (keyed remount), GO burst,
  lamp scale/glow, Roboto Condensed numerals, eyebrow label.

### Race screen (`CycleRaceScreen`)
- Chart looked like a debug plot: bare thin polylines, no gridlines, no axis
  labels, no area fills, no rider tags.
- Naked monospace clock with no frame/label.
- Background video flat 0.35 opacity, no vignette → muddy.
- No leader/rank emphasis.
- **Fix:** framed + labeled clock; gradient area fills per lane; gridlines with
  distance labels; styled goal line; gliding rider name chips (HTML overlay, no
  SVG distortion) with leader emphasis; vignette over the bg video.

### Results (`RaceResults`)
- Plain stacked list — dullest screen at the payoff moment.
- **Fix:** podium with medal accents (🥇🥈🥉), winner spotlight + crown, larger
  winner avatar, staggered row reveal, condensed display type.

### Cross-cutting
- No shared tokens (lobby `$cgh-*` vs hardcoded hex in race screens).
- No typographic character or motion language post-lobby.
- **Fix:** shared `_cgTokens.scss` (palette, Roboto Condensed display +
  JetBrains Mono telemetry, backdrop + eyebrow mixins) used across countdown /
  race / results / container chrome.

## Bug found during audit (load-bearing for ghost racing)
- `raceId` was `cr_${Date.now()}` but `YamlCycleRaceDatastore` slices `YYYYMMDD`
  out of the raceId to choose the history folder. Saves landed in a garbage dir
  that `listDates()` filtered out → **history & ghost candidates always empty.**
- **Fix:** generate `raceId` as a `YYYYMMDDHHmmss` timestamp.
