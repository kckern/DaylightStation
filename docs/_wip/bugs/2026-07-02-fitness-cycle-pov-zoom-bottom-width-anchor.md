# POV race view: zoomed-out road collapses to a narrow strip instead of anchoring full width at the bottom

- **Source:** voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02T21:53:07.949Z`
- **Audio:** `media/audio/feedback/fitness/20260702215307_J0bvRU.webm`
- **Type:** bug
- **Area:** Cycle Game — POV race view (`panels/PovGrid.jsx`, `lib/cycleGame/povFollowCam.js`, `lib/cycleGame/povWorld.js`)

## What the user said
> On the race, when it zooms out, the bottom width of the 3D track should always be full width at the bottom. It doesn't matter if that means we're changing the perspective or whatever. We should never just be like a little string in the middle even when we're zoomed out. The zoom out should always anchor the bottom perspective such that the entire width is contained on there.

## Problem / opportunity
The POV camera's follow/zoom logic (`povFollowCam`) dollies back to fit a widening leader-to-last-place gap, but as it pulls back the road narrows toward a thin strip in the middle of the screen instead of keeping the near (bottom) edge of the road filling the screen width. This was the exact failure mode the audit's "POV never loses anyone" work (commit `004f8b7cc` and follow-ons) was meant to fix for the *leader* (via gap compression + a horizon chip) — but the user's report describes the geometry itself losing width at extreme zoom-out, a framing/FOV problem rather than a leader-visibility problem. These may be the same root cause seen from a different angle, or a second, separate framing defect that survived that work.

## Desired outcome
At any zoom level — including the most zoomed-out state with the largest field spread — the road's near (bottom) edge should always span the full width of the panel. The camera should adjust field-of-view, dolly distance, and/or perspective (not just distance) to guarantee this, rather than letting a wide dolly-back shrink the apparent road width.

## Actionable tasks
- [ ] Reproduce: drive a race sim with a large, growing gap between leader and last place; observe the road width at the bottom edge of the POV panel as the camera pulls back.
- [ ] Inspect `povFollowCam.js`'s dolly/FOV math — does it hold FOV constant while increasing `camDist`, which would explain the road appearing to narrow (a fixed-FOV camera pulled straight back always shrinks near-field apparent width)?
- [ ] Determine the correct fix: either widen FOV as `camDist` grows (keeping near-edge width constant), or reproject/clamp so the near edge is always framed to full width regardless of far-field content, consistent with the user's "change the perspective if needed" allowance.
- [ ] Re-verify against the existing gap-compression + horizon-chip behavior from the POV rebuild — this fix must not reintroduce the "leader vanishes at large gaps" problem that work solved.

## Acceptance criteria
- At the largest tested rider spread, the road's bottom edge fills the full panel width — no narrow "string in the middle" framing.
- The leader remains visible (compressed per existing behavior) at all times; this fix does not regress that.
- Camera transitions between zoom states remain smooth (ties to the chart/motion-clock work — verify no new jank is introduced).

## Where to look
- `frontend/src/modules/Fitness/lib/cycleGame/povFollowCam.js` — camera dolly/target math (`camDist`, `CAM_FILL`, `MIN_DIST`/`MAX_DIST`, `LOOK_AHEAD`, `CAM_BEHIND`, `CAM_ELEV`).
- `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx` — where `camera.fov` is set/read and where `povFollowCam`'s output is applied to `controls.setLookAt`.
- `frontend/src/modules/Fitness/lib/cycleGame/povWorld.js` — road width/half-width constant (`ROAD_HALF_W`) that the framing needs to respect at the near edge.
- Prior related work for context: commit `004f8b7cc` (motion clock) and the POV "never loses anyone" task in `docs/superpowers/plans/2026-07-01-cycle-phase1-2.md` (T9).

## Context / evidence
None captured in `logs.recent` (this is a visual/geometry report, not something the current logging surfaces — `cycle_game.pov.camera` sampled telemetry, added same day, could be pulled for the exact `camZ`/`fov`/`distance` values during a reproduction run). Pointer: `logs.appLogDir` = `media/logs/fitness`.
