# Party Games Environment

`party-games` is the environment for co-located people sharing a primary display. It owns team setup, controller-role binding, buzzer arbitration, host and verifier companions, audio/AI/print effect policies, and household sourcing. Experiences provide rules, projections, and experience-specific presentation such as Activity Party's drawing canvas. Common visual primitives and normalized input adapters live in the Gaming platform.

The environment mounts an experience through `PartyGamesExperience`, which injects `gamingServices` capability ports. Jeopardy can arm and subscribe to buzzers or play named audio cues without importing Party Games. This keeps the same experience portable to School, Piano, developer, or future surfaces with different capability implementations.

## Screen deep links

Screen configuration decides whether Party Games is exposed on a particular physical surface:

```yaml
routes:
  party-games:
    app: party-games
```

With that route mounted, `/screens/{screen}/party-games/{experience}` opens the registered Party Games app and passes `{experience}` as its game parameter. The route parser, app registry, and parameter contract live in code; the surface-specific availability lives in household screen configuration. Experience manifests and content banks remain gaming configuration, not screen configuration.

Jeopardy and Activity Party use the direct Gaming coordinator. Activity Party supports Draw and Charades, performer-ready gates, rounds, deterministic timers and rotation, host modes, progressive reveals, score adjustments, and verifier confirmation for subjective hostless outcomes. Drawing checkpoints are transient and are deleted when an outcome commits.

Charades is also mounted as a focused Party Games experience with a seeded, deterministic family word bank. Its text decoder is an original reusable sixteen-segment SVG display: every segment is illuminated, warm yellow/pink/orange/white segments encode the secret, and cool cyan/blue/green segments provide the mask that dims through a physical red filter. The segment proportions were visually informed by Kaiser Zhar Khan's donationware “Digital Display TFB” font from True Fonts Blog; the font binary and glyph outlines are not bundled. Its image decoder accepts authored SVG artwork, renders the artwork as cyan through a CSS mask, and overlays a deterministic field of red filled bubbles and rings. That keeps source artwork presentation-independent and makes each clue's physical-filter pattern stable.

`GamepadAdapter` preserves ABXY/LR identity and binds a stable controller ID to a semantic role on press. The Gaming platform's `DrawingTabletAdapter` emits Pointer Event pressure and eraser metadata with touch/mouse normalization. It converts responsive CSS coordinates into the canvas backing-store coordinate system, clamps captured strokes to the canvas, and preserves independent pointer identities. Browser input is hosted by screen-framework and translated to `InteractionIntent` before experience code sees it.

Drawing checkpoints contain strokes rather than raster images. The client serializes checkpoint writes, the API authorizes them against the active performer, and the repository bounds stroke and point counts. Checkpoints are transient recovery state: terminal challenge events delete them, and they never enter the deterministic Gaming journal.

Dice outcomes commit before animation. Standard polyhedra may use Three.js, d100 uses percentile dice, and arbitrary sides or unavailable WebGL use deterministic 2D output. Household selection uses the same seeded mechanic without depending on party-games.

AI commentary and advisory judgments are short, fail-open, and newest-wins. Subjective proposals do not alter score until the configured verifier confirms. Host packets print only when explicitly requested unless the environment enables idempotent once-per-session auto-print.
