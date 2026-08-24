# Group Play Environment

`group-play` is the environment for co-located people sharing a primary display. It owns team setup, controller-role binding, buzzer arbitration, host controls, drawing surfaces, presenters, audio/AI/print effect policies, and household sourcing. Experiences provide rules and projections.

Jeopardy and Activity Party use the direct Gaming coordinator. Activity Party supports Draw and Charades, performer-ready gates, rounds, deterministic timers and rotation, host modes, progressive reveals, score adjustments, and verifier confirmation for subjective hostless outcomes. Drawing checkpoints are transient and are deleted when an outcome commits.

`GamepadAdapter` preserves ABXY/LR identity and binds a stable controller ID to a semantic role on press. `DrawingTabletAdapter` emits Pointer Event pressure and eraser metadata with touch/mouse normalization. It converts responsive CSS coordinates into the canvas backing-store coordinate system, clamps captured strokes to the canvas, and preserves independent pointer identities. Browser input is hosted by screen-framework and translated to `InteractionIntent` before experience code sees it.

Drawing checkpoints contain strokes rather than raster images. The client serializes checkpoint writes, the API authorizes them against the active performer, and the repository bounds stroke and point counts. Checkpoints are transient recovery state: terminal challenge events delete them, and they never enter the deterministic Gaming journal.

Dice outcomes commit before animation. Standard polyhedra may use Three.js, d100 uses percentile dice, and arbitrary sides or unavailable WebGL use deterministic 2D output. Household selection uses the same seeded mechanic without depending on group-play.

AI commentary and advisory judgments are short, fail-open, and newest-wins. Subjective proposals do not alter score until the configured verifier confirms. Host packets print only when explicitly requested unless the environment enables idempotent once-per-session auto-print.
