# Arcade game clock readiness — both surfaces

**Date:** 2026-09-26 (before a family game session the same evening)
**Question:** during play, does every game show a correct **count-up** of time
played, placed clear of the game, and can we reconstruct everything that
happened from the log store afterwards?
**Surfaces:**

| Surface | Where | How the clock is drawn |
|---|---|---|
| Console (RetroArch) | living-room Shield | `frontend/public/arcade-film.html` — an HTML "film" Fully Kiosk draws as a transparent, non-touchable overlay window over a separate Android app |
| Browser arcade (EmulatorJS) | garage fitness display | `frontend/src/modules/Fitness/widgets/EmulatorGame/` — a badge in the widget's own React tree |

Enforcement is `observe-only` (no `arcade_sessions` block in `gaming/games.yml`):
sessions are metered and published, nothing warns or stops a game. Both clocks
should therefore count **up**.

Prior audit: `2026-09-12-arcade-play-session-observability-audit.md`. Its F2
(garage reporter never constructed), F3 (browser under-reporting) and F6 (browser
metering needs a Shield) are fixed on `main`; see §5.

---

## 1. Headline

**Neither clock could render.** Commit `b20273b9a` (2026-09-19, "rename
PlaySession vocabulary to ArcadeGameSession") moved the backend's bus events to
`arcade.session.started|progress|ended`. Both clocks kept filtering on
`play.session.*`:

- `arcade-film.html:291,293,305` — `handle()` returned early for every real
  message.
- `useArcadeGameBudget.js:73-74` — the hook dropped every message.
- `EmulatorGameWidget.test.jsx:157` used the old name in its fixture, so the
  tests stayed green.

Metering itself was healthy the whole time. The garage recorded 38
`arcade.session.started` and 36 `ended` in the preceding 7 days, and the
Shield's film subscribed on every armed session. Only the clocks were deaf.
Nothing logged the dropped messages, which is why the regression went unseen
for a week.

**Fixed** in `dc16eeb0a` (details in §3).

---

## 2. Method

- Two code traces, one per surface, from session open to pixels, with every log
  event listed.
- Live reads:
  - `GET /api/v1/arcade-game-sessions/{health,open,placement}`
  - `gaming/games.yml` and `gaming/arcade-overlay.yml`
  - device config (`arcade_session_observation` / `arcade_session_overlay`)
  - the log store
- **Placement, rendered.**
  - Pulled each console's actual RetroArch border overlay from the Shield: the
    `.cfg` plus every piece image.
  - Composited each bezel at 1920×1080 exactly as the `.cfg` lays it out.
  - Rendered the real `arcade-film.html` on top in headless Chromium, once per
    zone of every system, with a short and a long name at 5:07 and 1:44:59 — first at 1920×1080, then again at the Shield's real 960×540 CSS px @2x (see the live check below).
  - Measured the banner's rect after the rise animation settles, against the
    system's game-screen rect.
- **Contract test.** A jsdom test (`arcadeFilmContract.test.js`) drives the film
  with message shapes taken from `EventBusArcadeGameSessionAnnouncer`.

---

## 3. Findings and status

Severity is for tonight's session.

### Critical

| # | Finding | Status |
|---|---|---|
| C1 | Both clocks filter on `play.session.*`; backend sends `arcade.session.*` — no timer renders anywhere | **Fixed.** `ARCADE_SESSION_EVENTS` in `shared/contracts/media/topics.mjs` feeds the announcer, the enforcement notify, and the hook. The film (static page, cannot import) is pinned to the same strings by the contract test. Both clocks still accept the legacy names and log `unknown-event` (warn, once per name) for anything else on their topic. |

### High

| # | Finding | Status |
|---|---|---|
| H1 | **Film ignores pause.** `render()` extrapolated `playedMs + (now − receipt)` regardless of `state`. During a pause the clock climbed ~10 s and snapped back on every message. Same for `unknown`. | **Fixed.** Extrapolates only when the last message was not `paused`/`unknown`, capped at 25 s. Label reads `paused` while paused. The fitness hook already froze on pause; it now also caps drift at 25 s. |
| H2 | **Film staleness masked, and the ticker never restarted.** Any socket message (the server's 30 s `heartbeat`, `bus_ack`) refreshed `lastMessageAt`, so a backend that stopped publishing was never shown as stale. Conversely, after a real stale period `startTicking()` was only called from `show()`, so the clock then moved in 10 s jumps for the rest of the session. | **Fixed.** Only session messages count as contact. Every started/progress message restarts the ticker. Recovery is logged. |
| H3 | **Fitness avatar would cover the game.** `.emu-overlay__avatar { height: 58% }` has no definite parent height inside the session badge, so it falls back to the portrait's natural size (~950 px). Latent only because C1 kept the badge from rendering. | **Fixed.** `1.6em` square inside the session badge. |
| H4 | **Deploy gate blind to games.** A game with no workout roster passes the garage check, and RetroArch is not a Player video. A redeploy mid-game blanks the film, and past the 60 s liveness window settles the session `lost`. The next observation opens a new one, so the clock restarts at 00:00. | **Fixed.** `scripts/deploy-gate.sh` section 6 blocks while `GET /open` lists any session, and fails closed if it cannot ask. `CLAUDE.local.md` gate list updated to seven conditions. |
| H5 | **The film was unobservable.** It had zero logs and swallowed handler exceptions. Nothing could answer: did it load, where was it placed, what did it show, did it go stale? | **Fixed.** The film ships `arcade.film.*` over its own socket in the framework's `topic: logging` batch shape (`context.app: arcade-film`). Events: `loaded`, `subscribed`, `shown` (clock, label, state, zone, rect, `--u`, fit, shed list), `sample` (1/min), `stale`, `recovered`, `disconnected`, `ended`, `unknown-event`, `handler-failed`, `page-error`. |
| H6 | **The fitness clock was unobservable.** | **Fixed.** `arcade.clock.subscribed`, `first-message` (per session: state, playedMs, fields), `stale`, `fresh`, `ended`, `unsubscribed`, `unknown-event`. |
| H7 | **What each clock was told was never logged.** The per-publish log was `debug`, and debug is not shipped. | **Fixed.** `arcade.session.published` at info, with sessionId, playedMs, state, system, placement zone and display name. Started/ended and every state change log immediately; steady progress logs once a minute per device. |

### Medium

| # | Finding | Status |
|---|---|---|
| M1 | **Unplaced system → full-width bar over the game.** A ROM the launcher catalog doesn't know gets `placement: null`. The film then fell back to a full-width bottom bar (~170 px), which covers the bottom of the picture on N64, SNES, NES and GameCube. | **Fixed.** Fallback is a small stacked pill at `[0.88, 0.03, 0.11, 0.10]`, top-right; the zone is logged as `fallback`. The launcher catalog's eight systems all have placement. Unplaced cores exist on the Shield (DuckStation, Stella, VBA-M, gpSP, Snes9x 2010, Genesis Plus GX Wide, 2048) and are reachable only by hand-launching. |
| M2 | **`overlay.fields: []` hid the clock.** `resolveOverlayConfig` defaults to `[]`, and the film treated that as "hide everything". | **Fixed.** The film always keeps the timer. The live config lists `[player, system_label, timer]`. |
| M3 | **Clock format.** 105 minutes read `105:00`. The film re-fit only on message arrival, not when the text got wider. | **Fixed.** `h:mm:ss` past an hour, on both surfaces. The film re-fits whenever the clock text changes length. |
| M4 | **Unlabelled fitness number.** The widget computed `played` and dropped it, so the badge showed a bare number. | **Fixed.** The unit under the number reads `played` / `paused` / `offline`. |
| M5 | **Playing-vs-paused evidence not logged.** On the Shield, "paused" means "RetroArch burned ≤ 2 CPU ticks since the last poll"; the RetroArch menu may exceed that and bill as play. | **Instrumented, not changed.** `arcade.observe.transition` now carries `cpuDelta`, so tonight's logs answer whether menus bill. The threshold is left alone until there is data. |
| M6 | **Fitness badge is small and over bezel art.** Top-left at 2 %, scale 0.5: ~14 px timer text at 1080p, over the GB "reset" engraving and the GBA L shoulder. Clear of every game screen (all browser cutouts start at x ≥ 18.7 %). | **Verify after deploy.** Render the badge on the live garage bezels via the direct-launch route, then set `arcade-overlay.yml` scale/offsets from what the render shows. |
| M7 | **Tail of play dropped; fitness clock snaps back.** Time accrues only across PLAYING→PLAYING pairs, and heartbeats are 10 s apart. So up to ~10 s is dropped at every pause or exit, and the local clock visibly steps back when the `paused` message lands. | **Open — deliberately not changed today.** The fix changes observation timing in the reporter (send a closing `playing` sample before the transition, at `observedAt + 1 ms`). That touches billing arithmetic, which should not change hours before a session. Cost tonight: ≤ 10 s per pause/exit, never over-billed. |
| M8 | **Loading a save restarts the fitness clock.** "Continue as …" remounts with a new `loadId`, which ends the session and opens another. | **Open — same reason as M7.** It changes session identity. The history stays correct (two sessions); the on-screen count resets. |

### Low

| # | Finding | Status |
|---|---|---|
| L1 | First ~10–20 s of Shield play uncounted: the first CPU sample has no baseline, so it reads `unknown` | Open — by design of the CPU probe. |
| L2 | A browser tab reload leaves the session open up to ~90 s before it is settled `lost` (no `pagehide` beacon) | Open. |
| L3 | Idle time in the browser arcade counts as play (no input-idle signal) | Open — no idle source yet. |
| L4 | `play.overlay_config.failed` kept the pre-rename name | **Fixed** → `arcade.overlay_config.failed`. |
| L5 | `arcade.overlay.armed` had no url/session/error | **Fixed.** New `arcade.overlay.arming` / `disarming` with sessionId; `armed` carries url and gravity, plus the error on failure. |

---

## 4. Placement — rendered, not assumed

Every zone in `gaming/games.yml` was checked against the real border art, with
the film's actual fit logic:

| System | Zones | Chosen (zone[0]) | Fits | Overlaps game | Clock visible |
|---|---|---|---|---|---|
| n64 | right, left | right | ✓ | none | ✓ |
| snes | left, right | left | ✓ | none | ✓ |
| genesis | top, bottom, left, right | top | ✓ | none | ✓ |
| nes | left | left | ✓ | none | ✓ |
| gb / gbc | bottom, left, top, right | bottom | ✓ | none | ✓ |
| gba | top, bottom, left, right | top | ✓ | none | ✓ |
| gamecube | left, right | left | ✓ | none | ✓ |

That is 46 renders, with 0 overlaps, 0 overflows and 0 hidden clocks. An
earlier pass reported "overlap" on every **top** zone. That was measured
mid-animation: the banner rises from 140 px lower over 0.5 s, so it briefly
crosses the game on entry. This is cosmetic and lasts half a second.

Legibility: the clock is always readable. In the two tightest zones (SNES
right, 203×81 px; GB bottom, 462×77 px) the name and "played" label drop to
~5 px text. Neither is SNES's chosen zone. GB's chosen zone is bottom, where the
name is small but the clock is clear.

---

### Live check on the Shield (same evening, over a running game)

Deployed `7db66d8f9` mid-game under an owner override. Pokémon Crystal was
running in RetroArch.

- **The game was undisturbed.** RetroArch stayed in the foreground throughout.
- **The meter resumed the same session.** It logged `arcade.session.resumed` at
  466 s; the ~77 s outage stayed inside the 60 s liveness window measured from
  the last observation.
- **The overlay was refreshed without restarting anything.** Pointing Fully's
  `webOverlayUrl` at a cache-busted URL reloads only the non-focusable overlay
  window.

The first live render found what the 1920×1080 renders could not: **the
Shield's WebView lays the film out at 960×540 CSS px (DPR 2)**. At that size
the 4.5 px text floor, tuned at 1920 wide, was too big for the GB bottom zone
(231×39 CSS px):

- the name was clipped at the top
- "GAME BOY COLOR" wrapped
- "PLAYED" was cut off at the bottom
- the film logged `fits: false`, with `av` and `bar` shed

Fixed in `b219691f5`:

- the floor scales with page width
- the system label stays on one line and is shed after the bar and portrait
- the logged rect is the resting layout box, not a read taken mid-animation

All 46 zones were re-rendered at 960×540 @2x: all fit, none overlap the game.
The fixed file was swapped into the running container's `dist/` (identical to
the committed file) and the overlay re-pointed.

Live result: `16:23 PLAYED`, fitting cleanly, with `arcade.film.shown` reporting
`fits: true, shed: []`.

## 5. Prior audit (2026-09-12) — status

| Prior finding | Now |
|---|---|
| F1 hand-started Shield game never opens a session | Fixed on `main` — the RetroArch log is read while running; ROM path → catalog → system |
| F2 garage reporter never constructed | Fixed — meter id from the fleet device id |
| F3 browser under-reports (no pause, split on claim, anonymous) | Fixed — pause reported, claim keeps the session, identity attributed |
| F4 living-room meter invisible in the log store | Fixed — `arcade.*` events ship; now also `published`, film and clock logs |
| F6 browser metering needs a Shield | Fixed |
| (new) F3's "budget hook not mounted" | Became "mounted but deaf" (C1) — fixed |

---

## 6. Reading tonight's session from the log store

```bash
# Everything the arcade did, in order
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:~"^arcade\." AND _time:6h | sort by (_time)' -d 'limit=1000'

# What each clock was told (state changes at once, progress 1/min per device)
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="arcade.session.published" AND _time:6h'

# What the Shield film actually showed, where, and whether it fit
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=context.app:arcade-film AND _time:6h'

# Garage clock transitions
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:~"^arcade\.clock\." AND _time:6h'

# Did any menu time bill as play? (cpuDelta at each transition)
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="arcade.observe.transition" AND _time:6h'
```

Questions now answerable:

- Did a clock load and subscribe?
- What did it show, and where?
- Did it fit or shed detail?
- When was it stale, and when did it recover?
- What playedMs and state did the backend send, minute by minute?
- Why was a Shield state classed as playing or paused?

Still not answerable (the Open items above): time dropped at pause/exit (M7),
and whether an idle browser arcade was actually being played (L3).

---

## 7. Changes made (`dc16eeb0a` and follow-up)

- `shared/contracts/media/topics.mjs`: `ARCADE_SESSION_EVENTS`.
- `EventBusArcadeGameSessionAnnouncer.mjs`:
  - uses the constant
  - logs `arcade.session.published`
  - renames the overlay-config failure event
- `arcadeGameSessions.mjs`: the enforcement notify uses the constant.
- `FullyKioskArcadeGameOverlay.mjs` and `OverlayArcadeGameSessionAnnouncer.mjs`:
  richer arm/disarm logs.
- `ArcadeGameSessionTracker.mjs`: `cpuDelta` on `arcade.observe.transition`.
- `arcade-film.html`: event names, pause/unknown freeze, drift cap, stale
  handling, ticker restart, timer always shown, corner fallback, `h:mm:ss`,
  re-fit on width change, `arcade.film.*` logs.
- `useArcadeGameBudget.js`: event names, drift cap, `paused` label, `h:mm:ss`,
  `arcade.clock.*` logs.
- `EmulatorGameWidget.jsx` and `resolveOverlayValue.js`: label under the number.
- `EmulatorConsole.scss`: avatar size, tabular clock digits.
- `scripts/deploy-gate.sh`: section 6 (open arcade sessions).
- Tests:
  - `arcadeFilmContract.test.js` (12 cases)
  - widget fixture updated to the real event name
  - all 86 fitness/emulator tests and 954 related backend/frontend tests pass
- Docs: `docs/reference/gaming/arcade-game-sessions.md` (event names, film
  rules, log catalog, gate).
