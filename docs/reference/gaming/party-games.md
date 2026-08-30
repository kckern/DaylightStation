# Party Games Environment

`party-games` is the environment for co-located people sharing a primary display. It owns team setup, controller-role binding, buzzer arbitration, host and verifier companions, audio/AI/print effect policies, and household sourcing. Experiences provide rules, projections, and experience-specific presentation such as Activity Party's drawing canvas. Common visual primitives and normalized input adapters live in the Gaming platform.

The environment mounts an experience through `PartyGamesExperience`, which injects `gamingServices` capability ports. Jeopardy can arm and subscribe to buzzers or play named audio cues without importing Party Games. This keeps the same experience portable to School, Piano, developer, or future surfaces with different capability implementations.

The Party Games catalog also exposes each mounted experience's `theme`, `input_profile`, `lifecycle_capabilities`, and declared inputs. Setup is capability-driven: ordinary games proceed directly from player selection, while only experiences declaring `input_profile.gamepad: host-and-buzzer` enter controller binding. A completed experience returns a normalized `gaming-result/v1` result to the shell. Both ordinary `?session=` links and ephemeral `?diagnostic_session=` links can attach and resume; a completed resume goes directly to the terminal result instead of recreating the game.

TV and companion presenters share two import aliases: `@gaming` resolves to the Gaming module root and `@gaming-ui` resolves to its primitive layer. Vite and Vitest own the same mapping so production and tests cannot resolve the architecture differently.

Jeopardy and Activity Party use the direct Gaming coordinator. Activity Party supports Draw and Charades, performer-ready gates, rounds, deterministic timers and rotation, host modes, progressive reveals, score adjustments, and verifier confirmation for subjective hostless outcomes. Drawing checkpoints are transient and are deleted when an outcome commits.

Charades is also mounted as a focused Party Games experience with a seeded, deterministic family word bank. Its text decoder is an original reusable sixteen-segment SVG display: every segment is illuminated, warm yellow/pink/orange/white segments encode the secret, and cool cyan/blue/green segments provide the mask that dims through a physical red filter. The segment proportions were visually informed by Kaiser Zhar Khan's donationware “Digital Display TFB” font from True Fonts Blog; the font binary and glyph outlines are not bundled. A separate image-decoder renderer is reserved for cyan SVG line art masked by red circles/bubbles.

`GamepadAdapter` preserves ABXY/LR identity and binds a stable controller ID to a semantic role on press. The Gaming platform's `DrawingTabletAdapter` emits Pointer Event pressure and eraser metadata with touch/mouse normalization. It converts responsive CSS coordinates into the canvas backing-store coordinate system, clamps captured strokes to the canvas, and preserves independent pointer identities. Browser input is hosted by screen-framework and translated to `InteractionIntent` before experience code sees it.

Drawing checkpoints contain strokes rather than raster images. The client serializes checkpoint writes, the API authorizes them against the active performer, and the repository bounds stroke and point counts. Checkpoints are transient recovery state: terminal challenge events delete them, and they never enter the deterministic Gaming journal.

Dice outcomes commit before animation. Standard polyhedra may use Three.js, d100 uses percentile dice, and arbitrary sides or unavailable WebGL use deterministic 2D output. Household selection uses the same seeded mechanic without depending on party-games.

AI commentary and advisory judgments are short, fail-open, and newest-wins. Subjective proposals do not alter score until the configured verifier confirms. Host packets print only when explicitly requested unless the environment enables idempotent once-per-session auto-print.

Phone host rendering is selected through an experience-ID presenter registry. Registered experiences receive show-appropriate controls and human phase language; an unknown experience gets a truthful unsupported-host state instead of inheriting Jeopardy controls.

## Board-game expansion boundary

Party Games provides a reusable entertainment-TV presentation grammar, not a board-game ontology. A future Monopoly-like experience can reuse the stage, player identity, focus/control states, authoritative sessions, committed random outcomes, companion surfaces, handoffs, audio, and results. Board topology, piece positions and movement, decks, money ledgers, property ownership, pass-space effects, buildings, auctions, trades, mortgages, and bankruptcy must live in a versioned game-family rules capability such as `economic-board@1`.

That separation keeps legal game state deterministic and replayable while allowing the same facts to be presented as a TV board, a phone controller, or a later surface. Generic board, piece, card, or economy platform components should be introduced only after two real experiences demonstrate the same semantics; visual resemblance alone is not a platform abstraction.

## Ephemeral diagnostic sessions

Use the Party Games CLI when a presenter needs to be observed at a specific rule state without adding ordinary snapshots, journals, effects, print jobs, or drawing files:

```sh
npm run gaming:party -- catalog
npm run gaming:party -- create charades
npm run gaming:party -- advance diagnostic:ID performer.ready
npm run gaming:party -- advance diagnostic:ID challenge.start
npm run gaming:party -- override diagnostic:ID --set phase=performing --set deadline=4102444800000
npm run gaming:party -- show diagnostic:ID --json
npm run gaming:party -- delete diagnostic:ID
```

`create` accepts either a mounted definition ID or experience ID, uses the environment’s first team preset, and prints a direct Party Games URL containing `diagnostic_session`. `advance` passes a legal command through the real rule runtime. Add command fields with `--data '{"teamId":"team_1"}'` and use `--actor` when a participant identity matters. `override` applies a merge patch only to the diagnostic state; repeat `--set path=value` for multiple fields. `show --json` includes the in-memory history of creation, legal commands, and overrides.

Diagnostic endpoints require host authority. Sessions use the `diagnostic:` prefix, live only in the backend process, expire after four hours, and are capped at 32 active sessions. A restart removes them. Creating one reads the current authored definition without pinning/archive writes. Diagnostic effects are empty, printing is suppressed, and drawing checkpoints remain in memory. These guarantees make the path suitable for visual QA and observability, not recovery, replay certification, or multiplayer persistence testing.

Set `DAYLIGHT_BASE_URL` or pass `--base-url` when the app is not available at the CLI default. `list` reports active diagnostics and `url` reprints an attach URL.
