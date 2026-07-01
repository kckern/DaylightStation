# Content Filter Layer (CleanFlix/VidAngel-style) — Design

**Date:** 2026-06-30
**Status:** validated design, partial build (CLI + data pipeline done; consumer + Admin pending)
**Scope:** a filtering layer for `frontend/src/lib/Player/` — skip + mute/bleep + (manual) blur.

---

## 1. Objective

Watch owned media (Plex library) with objectionable content skipped, muted/bleeped, or
blurred — like ClearPlay / VidAngel / TVGuardian, but built into the DaylightStation
Player and customizable to the platform (theming, custom bleep SFX, plot-explainer title
cards on long skips). Legal basis: private home filtering of authorized copies (Family
Movie Act 2005); all client-side, no re-encode.

## 2. Core architecture — one EDL, many producers, one consumer

The whole system pivots on a normalized **filter document** keyed to a content id.
Everything else is a *producer* that writes one or the *consumer* that reads one.

```
producers ───────────────► FilterEDL (SSOT) ───────────► consumer
  VidAngel import (export)      per contentId            useContentFilter hook
  MCF import (.mcf/WebVTT)                               + <FilterOverlay>
  Whisper forced-align                                   (client-side, real-time)
  SRT wordlist
  manual (Admin)
```

**Apply client-side, real-time** (reuses the CRT/upscale overlay precedent in
`VideoPlayer.jsx`): skip = `transport.seek(out+ε)`; mute = `el.volume=0` or bleep tone;
blur = absolutely-positioned overlay div mapped onto the rendered video box. Toggleable
per session, no transcode.

## 3. The 3-layer cascade (inheritance + extension)

Novel features describe **how to present a filter**, not **what to filter**. Separating
those keeps the base portable and the customization ours. Resolution order (like CSS):

**Layer 1 — Base EDL (vendor-neutral, portable).** Stores the *observation*, not the
action. Round-trips losslessly to `.mcf` (WebVTT).
```yaml
# data/household/shared/content-filter/edl/{ratingKey}.edl.yml
contentId: plex:370578
precision: ms            # ms | second-approx (second-approx needs Whisper-snap)
source: vidangel         # vidangel | mcf | whisper | manual
cues:
  - id: va123
    category: language/profanity/fuck   # group/.../leaf
    channel: audio       # audio | video | both   (the action HINT)
    severity: medium     # low | medium | high
    in: 168.20           # seconds (float)
    out: 168.55
    label: f-word
    suggestedType: mute  # default action from source; profile may override
```

**Layer 2 — Profile/theme (global, rule-based, zero per-title work).** Resolves
(category, channel, severity) → action, and owns presentation.
```yaml
# data/household/shared/content-filter/profiles/family.yml
categories:
  language/profanity: { action: mute }
  violence/graphic:   { action: skip }
  sex_nudity:         { action: skip }
  violence/non_graphic: { action: off }
treatments:
  mute: { default: {replace: silence}, language/profanity: {replace: sfx, sound: car-horn} }
  skip: { minTitleCardSec: 30 }     # long skips auto-trigger an explainer card
  blur: { style: bar }
theme:  { font: "Roboto Condensed", barColor: "#000" }
sounds: { car-horn: /assets/filter-sfx/car-horn.mp3, sheep-baa: /assets/filter-sfx/sheep.mp3 }
```

**Layer 3 — Per-title override (DaylightStation-only).** Holds what no standard format
has: plot-explainer text, per-scene custom treatment, manual blur rects, cue disables.
```yaml
# data/household/shared/content-filter/overrides/plex:370578.yml
extends: edl/370578.edl.yml
cards:
  - { after: va456, text: "Skipped a 3-min torture scene; Six escapes and regroups." }
cueOverrides:
  va123: { replace: sfx, sound: sheep-baa }
  va789: { disabled: true }
addCues:
  - { category: sex_nudity, channel: video, in: 4512, out: 4518,
      rect: {x: .4, y: .55, w: .2, h: .18}, label: manual }
```

Re-pulling Layer 1 from VidAngel/MCF never clobbers Layers 2–3 — they bind by cue-id /
category, not file identity.

## 4. Sources & precision (POC findings 2026-06-30)

- **VidAngel** — best coverage. `bff/tag-sets` (token-gated). Tags are integer-SECOND
  *approx* keyed to VidAngel's recording → DRIFT ±2.5s vs our file (measured). audio→mute
  (point), audiovisual→skip. NO region data (they skip visual, never blur).
- **MCF** (moviecontentfilter.com) — open WebVTT subset, **millisecond** timestamps
  (`precision: ms`, no snap needed), category=severity=channel, free-licensed. Sparser
  coverage. The interop boundary: only Layer 1 serializes to/from `.mcf`.
- **Whisper word-align** — upgrades `second-approx` mute cues to ms by aligning a ±2s
  window around each cue (reuses `ITranscriptionService`). POC: reliable where extraction
  succeeds; bleep-then-retranscribe verifies removal. **Skips are fine at second-level**
  (+pad); only mutes need the snap.
- Plex `.edl` / Kodi — trivial third importer, mostly commercial-skip.

## 5. Build status (this session)

Done:
- `cli/contentfilter.cli.mjs` (renamed from vidangel.cli.mjs): `catalog-sync`, `map
  [--resolve]`, `search`, `tags`, `export`, `bulk-export`, `match`.
- VidAngel API mapped: `Token` auth; search/works/movies PUBLIC, tag-sets 401-gated;
  full catalog = 4170 titles cached offline.
- `plex-vidangel-map.yml`: **587 confident plex→VA matches**.
- **499 movie EDLs bulk-exported** (83,620 cues: 47,713 skip + 35,907 mute), 0 errors.

Also done (consumer, TDD — 27 tests):
- `frontend/src/lib/Player/contentFilter.js` — L1←L2←L3 resolver (`resolveEffect`
  longest-prefix, `resolveEffectiveCues`, `cuesActiveAt`).
- `frontend/src/lib/Player/filterEffects.js` — **extensible effect registry**
  (skip=transport; mute/bleep/duck=audio; blur/censor-bar/pixelate/full-blur/title-card=overlay;
  `registerEffectHandler` for custom). Adding an effect = one registration.
- `frontend/src/lib/Player/useContentFilter.js` — registry-driven hook, enter/exit
  diffing, injectable SFX player, returns `{activeOverlays, activeCard, effectiveCues}`.
- `frontend/src/modules/Player/components/FilterOverlay.jsx` — maps overlay cues +
  cards onto the video box (normalized rect → %; Roboto Condensed card theme).
- `import-mcf` / `export-mcf` on the CLI (round-trip verified).

Pending:
- **VideoPlayer wiring** — mount `useContentFilter` + render `<FilterOverlay>` (props:
  edl, profile, override, transport, getMediaEl); add a chrome toggle. Load EDL/profile
  via a small API from `content-filter/edl|profiles|overrides`.
- Bleep SFX assets + `content-filter/profiles/*.yml` (a default "family" profile).
- Rect letterbox-precise mapping (inset to real content rect when object-fit letterboxes).
- Whisper-snap refinement producer (extract from homeserver file, not flaky HTTP range).
- Admin authoring tool (manual cues, blur rects, plot cards) + time-remap calibration.

## 6. MVP cut

VidAngel/MCF import → Layer-1 EDL → a single "family" Layer-2 profile (skip violence/sex,
mute profanity, silence replacement) → client-side skip+mute in VideoPlayer, toggle in
chrome. Defer: blur, title cards, custom SFX, Whisper-snap, Admin authoring.
