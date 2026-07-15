# GameShow Module — Full-Scale UX / Layout / Color / Typography / Flow / Polish Audit

**Date:** 2026-07-15
**Scope:** `frontend/src/modules/GameShow/` (shell, Jeopardy game, mobile host companion) as rendered inside `frontend/src/screen-framework/` — specifically the living-room screen contract.
**Method:** Full source read of all 2,414 lines (every component, reducer, hook, and SCSS file), cross-checked against `ScreenRenderer.jsx`, `RemoteAdapter.js`, `GamepadAdapter.js`, the living-room screen YAML, and the actual data/media volumes on this host.

---

## 0. The frame contract (what "16:9" actually means here)

This is the single most important fact for the whole audit, and most findings flow from it:

- `data/household/screens/living-room.yml` declares `resolution: 960×540`. `ScreenRenderer.jsx:375-382` renders the screen as a **literal fixed 960×540 CSS-pixel box** (`position: relative; overflow: hidden`), letterboxed and centered in the real viewport. The Shield WebView happens to be exactly 960×539 CSS @ 2× DPR, but the contract is "you get a 960×540 box, anything past it is silently clipped."
- Root font-size is the browser default **16px** — nothing in the app scales `rem` to the frame. So every `rem` in GameShow SCSS is a fixed 16px-based unit inside a fixed 540px-tall box. There is no scaling layer between the module and the frame.
- GameShow mounts two ways (`GameShow.jsx:49-51`): as a registered screen widget (`builtins.js:30`, gets `dismiss`) and via `/app/gameshow` (`appRegistry.js:25`, gets `clear`). The host companion is a separate phone route (`main.jsx:172`).

**Verdict on the contract:** the module *mostly* honors it (`width/height: 100%`, no page scrolling), but it has three concrete violations — vertical overflow at classic board sizes (§1.1), `vh` units that reference the real viewport instead of the frame (§1.3), and absolutely-positioned chrome that depends on an ancestor it doesn't own (§1.4).

---

## 1. Layout — fit inside 960×540

### 1.1 ❌ BLOCKER: A classic 5-row board does not fit; the scoreboard gets clipped off-frame

`Jeopardy.scss:14-21` gives every tile `min-height: 5.5rem` (88px) and the board grid only defines columns — **`grid-template-rows` is never set, and the `--rows` custom property that `Board.jsx:8` carefully computes is never consumed by any CSS.** Rows are therefore intrinsically sized by `min-height`, not fitted to the frame.

The math for the frame (540px tall, 16px rem):

| Element | Height |
|---|---|
| Scoreboard (`Scoreboard.scss`: 0.75rem×2 pad + name 1.1rem + score 2rem + team pad) | ~108px |
| Available for board | **~432px** |
| Board padding (1.5rem × 2, `Jeopardy.scss:5`) | 48px |
| Category header row (1.4rem text + 0.75rem×2 pad) | ~51px |
| 5 clue rows × 88px min-height | 440px |
| 5 row gaps × 0.5rem | 40px |
| **Board content total** | **~579px in a 384px slot** |

A canonical 6-category × 5-clue Jeopardy board overflows the frame by ~150px. Because `.jp-board` is `flex: 1` with `min-height: auto` content, it refuses to shrink; the scoreboard is pushed below y=540 and `screen-root`'s `overflow: hidden` **silently amputates it** — scores, the pulsing "who buzzed" indicator, and the turn marker all vanish. The bundled sample set (`data/content/games/jeopardy/sample-family-night.yml`, ~3 clues per category) happens to fit at ~339px, which is presumably why this hasn't been seen yet: the layout works for the demo content and breaks for the content the game is actually modeled on.

The inverse problem also exists: with the 3-row sample set, tiles sit at their 88px minimum and ~90px of dead backdrop hangs below the board instead of the tiles growing to fill. The board neither shrinks nor grows — it's simply not fitted to the frame at all.

**Fix direction:** make the board own its box: `grid-template-rows: auto repeat(var(--rows), 1fr)` (finally using `--rows`), drop `min-height` from tiles, and let `1fr` rows divide whatever height the frame gives them. Font sizes inside tiles then need `clamp()`/container-query units so `$1,000` doesn't overflow a short tile.

### 1.2 ❌ HIGH: Clue screen has no vertical budget either

`.jp-clue` (`Jeopardy.scss:23-33`) stacks banner (2rem text + 72px timer ring), optional media, prompt at 3.2rem/51px (`components.scss:8`), optional revealed answer at 2.2rem, the buzz-in banner (2rem + padding + pulse), and the legend — as a plain flex column with no `justify-content` strategy, no text fit-scaling, and `.gs-reveal` claiming `height: 100%` *inside* that already-shared column. A 3-line clue with an image attachment plus a revealed answer plus a locked-team banner cannot fit in 540px. Long trivia prompts are the *normal* case for this content type, not the edge case. There is no type-scaling (the classic pattern: shrink prompt font as character count grows), so overflow is again clipped silently.

Also note `.gs-reveal { height: 100% }` inside `.jp-clue`'s flex column fights the banner/legend for the same 100% — the prompt block will overflow its slot whenever siblings are present.

### 1.3 ❌ HIGH: `vh` units break the frame contract

`components.scss:12-13` — clue media is capped at `max-height: 50vh`. `vh` measures the **real browser viewport**, not the 960×540 frame. On the Shield they coincidentally match (the WebView viewport *is* ~960×539), but on any larger viewport where the screen is letterboxed (dev browser, office Brave, future kiosks), 50vh can exceed the entire frame height, and an image clue will shove the prompt and legend out of the clipped box. Inside screen-framework, only `%`, `fr`, or container-query units (`cqh`) are frame-safe. Same class of problem: `GameShowHost.scss:2` uses `min-height: 100vh`, which is correct *there* (the host is a real phone page) — the point is the TV-side module must never use viewport units.

### 1.4 ⚠️ MEDIUM: Absolutely-positioned chrome anchors to an ancestor the module doesn't own

`.gameshow` (`GameShow.scss:1-7`) is **not** `position: relative`, yet `__ws-warn` and `__hostqr` (`GameShow.scss:10-16`) are `position: absolute`. Inside screen-framework this works by luck — `screen-root` is `position: relative` and happens to be the same box. Via `/app/gameshow` (AppContainer route) the nearest positioned ancestor is whatever that page provides, potentially the document — the QR could render outside the app region entirely. One line (`position: relative` on `.gameshow`) makes the module self-contained.

### 1.5 ⚠️ MEDIUM: The host QR overlaps the board for the whole game

`HostQr` renders persistently during the entire `playing` phase (`GameShow.jsx:126`), as a **90%-opaque white card** in the bottom-right of an already height-starved frame. On a full board it will sit on top of the last category's bottom tiles; during clues it sits over the legend. A QR needs to be scanned once, at the start. Show it large on the `round-intro` card (where there's dead space and a natural "everyone get set up" beat), then shrink it to a dim corner glyph or remove it during board/clue phases.

### 1.6 ℹ️ LOW: TeamSetup can't survive its own success

`TeamSetup.jsx:46-51` renders the **entire unassigned-user pool inside every team column** (each team card lists "+ Alice, + Bob, + Carol…"). With 2 teams × a 10-person household that's 20+ chips duplicated across columns, plus member chips, plus Guest/Remove buttons, in columns that have `min-width: 16rem` but no height management (`TeamSetup.scss:4-9` — no wrap, no scroll, `flex: 1` row). Four teams at 16rem + gaps ≈ 67rem = 1072px > 960px wide: **adding a 4th team overflows the frame horizontally.** The duplication also makes the pool ambiguous ("+ Alice" appears under both teams — tapping the wrong column assigns her there; there's no visual pool-vs-member distinction beyond 0.65 opacity).

---

## 2. Flow & input — can a person on the couch actually play this?

The living-room input is `type: remote` (`living-room.yml`): D-pad arrows, Enter/OK, Escape/Back. `RemoteAdapter.js` listens to the *real* keydown events and re-emits ActionBus actions — the original events still propagate, so raw `window` keydown listeners (which Jeopardy uses) do receive Arrow/Enter/Escape. **But arrow keys do not move DOM focus between `<button>`s — browsers only do that inside radio groups.** The module's shell phases are built entirely on focus + Enter.

### 2.1 ❌ BLOCKER: The set-picker — the first interactive screen — is unreachable by remote

`GameShow.jsx:94-105`: a vertical list of `<button>`s, **no `autoFocus`, no arrow-key handler, no focus management of any kind.** From the couch: arrows do nothing (no focused element, no spatial nav), Enter does nothing (nothing focused). The happy path is dead on arrival on the exact screen this module is designed for. The comment in `TeamSetup.jsx:2-3` ("all controls are buttons so arrow-key / gamepad focus traversal works without a custom focus engine") describes a mechanism that does not exist in browsers — `GamepadAdapter`/`RemoteAdapter` synthesize `ArrowUp` etc. (`GamepadAdapter.js:28-31`), not `Tab`, and nothing translates arrows into `.focus()` calls.

Affected phases (everything except the game board itself, which has its own cursor system):

| Phase | Focusable controls | Remote reachability |
|---|---|---|
| resume-gate | Resume (autoFocus) / Start fresh | Resume works via Enter; **Start fresh unreachable** |
| set-picker | one button per set | **Fully unreachable** |
| team-setup | dozens of chips + confirm | **Fully unreachable** |
| buzzer-bind | per-team bind + Start (autoFocus) | Start works; bind buttons unreachable |
| round-intro | Start (autoFocus) | ✅ |
| wager (DD) | −100 / +100 / Lock | **Unreachable** (see 2.2 — also non-functional) |
| final-wager / final-judging | steppers, per-team ✓/✗ | **Unreachable** |
| results | Play again (autoFocus) / Exit | Play again works; **Exit unreachable** |

In practice the game is only operable with a physical keyboard (Tab exists) or by scanning the QR — which itself only appears *after* you've traversed three unreachable phases. `keymap.js:2` explicitly punts ("wager/intro phases use focusable buttons instead"), so this is a known design decision that doesn't hold on the target device.

**Fix direction:** a tiny roving-focus hook (arrow keys move `.focus()` through a registered button list — ~30 lines, reusable across all five shell phases) or wiring these phases into the ActionBus `navigate`/`select` actions the framework already emits. The board's cursor system proves the module already knows how to do TV navigation; the shell just never got the same treatment.

### 2.2 ❌ HIGH: The on-TV Daily Double wager is a decoy — buttons render but do nothing

`Jeopardy.jsx:159-167` renders `WagerPanel` with `value={100}` and `onChange={() => {}}`. The −100/+100 steppers call `onChange` with a clamped value that is **thrown away**; the amount is hard-stuck at 100 (or the clamp floor). "Lock wager" then commits $100 every time. Only the phone host can set a real DD wager (`GameShowHost.jsx:107-114` keeps real `wagerDraft` state). `FinalRound.jsx:16` does keep local draft state, so the final-wager panel works — the DD path is simply missing the same three lines. Rendering interactive-looking controls that silently ignore input is worse than not rendering them.

### 2.3 ❌ HIGH (PLAUSIBLE — verify on device): Back/Escape during a clue likely kills the whole game

`living-room.yml` `actions.escape` includes `when: overlay_active → do: dismiss_overlay`. `RemoteAdapter.js:18` maps Escape → ActionBus `escape`, **and** the same keydown reaches Jeopardy's raw listener where Escape during a clue = `TIMEOUT` (`keymap.js:13`). Both consumers fire on one Back press: the clue times out *and* the screen framework dismisses the GameShow overlay mid-game. `ScreenOverlayProvider` exposes `registerEscapeInterceptor` for exactly this situation and GameShow never registers one. (A session checkpoint + resume-gate would soften the landing, but "Back during a clue exits the game" is still a trapdoor.) Needs a live-device confirm; the code paths both plainly exist.

### 2.4 ⚠️ MEDIUM: "Play again" throws away the roster

`PLAY_AGAIN` (`flowReducer.js:44-45`) returns to `set-picker` and the flow then re-enters `team-setup`, whose reducer re-initializes **from config presets** (`teamSetupReducer.js:25-31`) — the roster and buzzer bindings you just played with are discarded. Family game night reality: same people, next question pack. Play-again should skip straight to round-intro with teams and bindings carried over (offer "change teams" as the secondary action).

### 2.5 ⚠️ MEDIUM: Buzzer digits collide with other screens' input systems

`useBuzzers.js:43-49` binds a global listener: digits 1–9 always mean "buzz slot N" while GameShow is mounted. On the office screen the numpad **dual-emits a digit plus a companion nav key per macro button** (see office keypad memory / `2026-03-06-screen-framework-input-parity-audit.md`) — every keypad press would fire a phantom buzz. Also digit `4` is the ScreenRenderer input-failsafe reload key (`ScreenRenderer.jsx:205-214`); if the input adapter ever reports unhealthy, slot-4's buzzer reloads the screen. Scope the digit fallback to when the arbiter is actually armed, or behind a config flag.

### 2.6 ℹ️ Flow things that are genuinely good

- The **single action funnel** (`Jeopardy.jsx:69-92`) — keyboard, on-screen buttons, and phone commands all through `applyAction` — is exactly right; score math happens once, and the host companion can never desync the rules.
- Resume-gate + debounced checkpointing + `finishSession` is a complete lifecycle with a graceful "playable without checkpoints" degradation (`GameShow.jsx:72`).
- Three round modes (hosted/self/turns) with per-mode buzz arming (`Jeopardy.jsx:95-101`) and re-arming remaining teams after a wrong answer is faithful to the real game's rules engine.
- The reducers are pure, well-tested (193-line reducer test suite, integration test), and `SELECT_AT` reusing `SELECT_TILE` logic is clean.
- WS-degradation badge exists (spec §9) — the *signal* is right even though the presentation is cryptic (§6.4).

---

## 3. Color

The palette is: backdrop `#060ce9`, tile `#0a1bb0`, accent gold `#ffd54a`, danger `#ff6b6b`, six team colors (`teamSetupReducer.js:4`), and white/black overlays. Verdicts:

### 3.1 ❌ HIGH: Tile-on-backdrop contrast is ~1.1:1 — the board reads as a blue smear

`#0a1bb0` tiles sit on the `#060ce9` backdrop with 0.5rem gaps showing the backdrop through (`Jeopardy.scss:1-21`, `GameShow.scss:4`). These are two saturated blues of nearly identical luminance; the defining visual of the entire show — **a grid of discrete tiles** — has almost no edge definition. The real board reads because tiles are separated by near-black gutters. `used` tiles compound it: `rgba(10,27,176,0.25)` over blue backdrop ≈ backdrop, so used-vs-unused is communicated *only* by the missing `$` text, not by the strong "gone dark" state the format is famous for. Give the board a near-black well (`#020617`-ish) as the grid background, keep tiles `#060ce9`/`#0a1bb0`, and make used tiles genuinely dark.

### 3.2 ❌ HIGH: White text on team-color backgrounds fails contrast for half the palette

`.jp-clue__locked` (`Jeopardy.scss:28-31`) sets `background: var(--team-color)` with inherited white text. Team colors include `#e6b325` (gold, ~2.1:1 with white), `#2fbf71` (green, ~2.3:1), `#f28c28` (orange ~2.4:1) — all far below 4.5:1. The buzz-in banner — the highest-stakes moment in the loop, "who gets to answer" — is the least readable element for three of six teams. Pair each team color with a computed on-color (dark text on light team colors), or keep the banner surface dark and use the team color as a border/glow.

### 3.3 ⚠️ MEDIUM: Team 1's color collides with the UI accent

`COLORS[0] = #e6b325` is nearly the same gold as the global accent `#ffd54a` used for dollar values, focus outlines, confirm buttons, and the DD flash. Team 1 (the default first team, i.e., *always present*) is visually indistinguishable from "the UI is highlighting something." Reorder the palette so the first two teams are the blue/green/purple entries, or shift the accent.

### 3.4 ⚠️ MEDIUM: No color tokens — the palette is scattered as 20+ hex literals

`#ffd54a` appears 9 times across four SCSS files; `#060ce9` twice; `rgba(255,255,255,0.12/0.15)` five times; `#ff6b6b` three times; `#e05263` twice (as the danger tone in two different files with two different meanings). One `_tokens.scss` with `--gs-bg / --gs-tile / --gs-accent / --gs-danger / --gs-surface` would make every other color fix in this audit a one-line change and let a future non-Jeopardy game reskin the shell.

### 3.5 ℹ️ LOW: Negative scores get the same red as errors and timeouts

`#ff6b6b` is simultaneously "your score is negative" (`Scoreboard.scss:18`), "boot error" (`GameShow.scss:9`), and "timer expiring" (`TimerRing.jsx:12`). In a game where going negative is a normal, even comedic state, it shouldn't share a color with failure states. Minor, but it's the kind of semantic slippage tokens would prevent.

---

## 4. Typography

### 4.1 ❌ HIGH: A game show with no display face

No `font-family` is declared anywhere in the TV-side module — everything inherits the app's default UI stack (the host page at least picks `system-ui` explicitly, `GameShowHost.scss:9`). The genre's identity is ~50% typography: towering condensed dollar values, a distinctive serif for clues. Rendering `$1,000` in Roboto/system-ui at `font-weight: 800` with a hard offset shadow reads as a placeholder wireframe of a game show, not a game show. This is also where the frame is most forgiving — self-host two faces (a compressed grotesque for values/categories/score, a readable serif or slab for clue prose), ~100KB of woff2, no external requests (kiosk-safe). This is the single highest-leverage *aesthetic* fix in the module.

### 4.2 ⚠️ MEDIUM: 17 ad-hoc font sizes, no scale

Sizes in use: 0.6, 0.7, 0.8, 0.85, 0.95, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 3, 3.2, 5rem. Adjacent steps like 1.1/1.2/1.3/1.4 carry no perceivable hierarchy at 3m viewing distance; they're noise. A 5-step TV scale (e.g., 1.25 / 1.75 / 2.5 / 3.5 / 5rem) mapped to roles (caption / label / body / feature / display) would cover every current use and make the hierarchy legible from the couch.

### 4.3 ⚠️ MEDIUM: Clue text has a fixed size, but clues don't have a fixed length

`.gs-reveal__prompt` is a flat 3.2rem (`components.scss:8`). At 960px wide that's ~30 characters/line; a 200-character clue wraps to 7 lines (357px of a 540px frame) and clips (§1.2). Trivia content *requires* length-responsive type — bucket by character count (e.g., >120 chars → 2.4rem, >200 → 2rem) or use a fit-text measurement. Same for category names in tiles (`.jp-board__cat` 1.4rem, no wrap handling — "IN THE KITCHEN" is fine, a 3-word category with a long word overflows its 1fr column).

### 4.4 ℹ️ LOW: The hard-offset text-shadow is doing trade-dress work it can't finish

`text-shadow: 0.1rem 0.1rem 0 #000` (tiles, categories, prompt, title) gestures at the classic engraved look but at 22–38px sizes on 2× DPR it just reads as fringing, especially in the default UI font. With a proper condensed display face, a subtle `0 2px 0 rgba(0,0,0,.55)` plus a slight gradient on tile faces gets the depth honestly. Also `letter-spacing: 0.15em` on "DAILY DOUBLE" (`Jeopardy.scss:26`) is the only tracking treatment in the module — apply the same to category headers for coherence or drop it.

### 4.5 ℹ️ LOW: Legend and QR-caption sizes are below the 10-foot floor

`.gs-legend` is 1rem at 0.7 opacity (`components.scss:26`); the QR caption is **0.6rem** (`GameShow.scss:15`) — 9.6px CSS. Even at 2× DPR that's phone-density text on a TV. The legend is host-facing chrome so it can stay quiet, but ~1.25rem at full opacity in a dimmer color is the floor; the QR caption should just be bigger or gone.

---

## 5. Motion & game-feel (polish)

### 5.1 ❌ HIGH: Every phase change is a hard cut; the format's signature moments don't exist

The entire module has exactly one animation: `gs-pulse` (a box-shadow throb, defined in `Scoreboard.scss:20-23`, reused for binding/DD/buzz-lock). Meanwhile the audio engine has cues named `board-fill` and `reveal` (`Jeopardy.jsx:87-88`) with **no visual counterpart** — the sound design (had the files existed, see §6.1) promises choreography the screen never performs. Missing signature beats, roughly in impact order:

1. **Tile → clue zoom.** The tile expanding to fill the screen is *the* iconic transition of this format. Currently the board unmounts and the clue hard-cuts in.
2. **Board fill cascade** on round start (values popping in column-by-column) — the cue name literally describes this.
3. **Score changes snap** — `AWARD/DEDUCT` just re-renders the number. A 400ms count-up/down plus a brief team-color flash on the scoreboard card makes cause-and-effect legible from the couch (right now, after a judging, nothing on screen confirms *what happened to whom*).
4. **Daily Double reveal** — currently the wager panel just appears; the DD banner pulse only shows *after* wagering, on the clue. The gasp moment is pre-wager.
5. **Results** — "X wins!" as static text with no ceremony, while the (missing) `win` cue plays. Even a staggered entrance of the ranked list (gold/silver/bronze borders already half-exist via `--team-color`) would land it.
6. **Timer urgency** — the ring flips yellow→red at 25% (`TimerRing.jsx:12`) but nothing else escalates; classic pattern is a pulse or tick-tock in the final seconds.

None of this needs a motion library — CSS transitions on transform/opacity plus one `useEffect` count-up hook. And per the quality floor: gate all of it behind `prefers-reduced-motion` — which the current perpetual `gs-pulse` animations also ignore today.

### 5.2 ⚠️ MEDIUM: Focus is styled, but focus movement is invisible-by-absence

`:focus { outline: 3px solid #ffd54a }` is applied consistently (good discipline — 6 declarations), but since nothing moves focus on the TV (§2.1), the outline almost never appears. Once roving focus exists, consider `:focus-visible` + a slight scale so the "cursor" reads at distance, matching the board's `is-cursor` treatment (`Jeopardy.scss:20`) so the whole app has one selection language.

---

## 6. Copy, feedback & finish

### 6.1 ❌ HIGH: The audio pack doesn't exist on this host — the game ships silent

`AudioCueEngine.js:25` requests `/api/v1/gameshow/media/gameshow/{pack}/{cue}.mp3` → resolves under `media/apps/gameshow/`. On this server, `media/apps/` contains only `fitness/` and an **empty** `jeopardy/` directory — there is no `gameshow/classic/` pack, so all six cues (`buzz, correct, wrong, reveal, board-fill, win`) 404 on every play and the engine logs a warning each time. The failure mode is correctly non-fatal, but the shipped experience is a silent game show plus warning-log spam. Either commit a default pack (six CC0 sounds), or detect first failure and stop attempting (and surface "sound pack missing: classic" once in the admin/logs rather than per-cue).

### 6.2 ⚠️ MEDIUM: System-voice and dev-voice copy on a family TV

- Empty set-picker: **"No game sets in data/content/games/jeopardy/"** (`GameShow.jsx:103`) — a server filesystem path on the living-room TV. Should be: "No question packs yet. Add one from the admin panel." (with the path relegated to a log line).
- Set validation failures render raw: `` `${s.title} — ${s.error}` `` (`GameShow.jsx:100`) — parser/validation strings shown to players.
- Resume gate shows the machine id: `"sample-family-night — in progress"` (`GameShow.jsx:88`) — the set's *title* is what humans recognize.
- Host phase banner: `j.phase.replace(/-/g,' ')` → "final judging", "round intro" (`GameShowHost.jsx:66`) — lowercase state-machine names as UI headings.
- Buzzer-bind buttons: `"default slot_3"` (`GameShow.jsx:41`) — internal slot ids; "using buzzer 3" is the same information in product voice.
- Host waiting state leaks the session id: `"Waiting for the TV… (session gs_abc123)"` (`GameShowHost.jsx:51`).

### 6.3 ⚠️ MEDIUM: Ties are miscalled

`Results.jsx:6-10` sorts and crowns `ranked[0]` — with tied scores it declares an arbitrary winner ("Team 1 wins!") rather than "It's a tie!". For a family game this is not an edge case; it's an argument generator.

### 6.4 ℹ️ LOW: The offline indicator is a mystery glyph

`{!connected && <div className="gameshow__ws-warn">⚡</div>}` at 0.6 opacity (`GameShow.jsx:82`) — an unlabeled emoji whose meaning lives in a `title` tooltip no TV user can hover. "Buzzers offline — keyboard still works" is exactly the right message; put (a short form of) it on screen: a small pill, `⚡ buzzers offline`.

### 6.5 ℹ️ LOW: Assorted finish nits

- `gs-pulse` keyframes live in `Scoreboard.scss` but are consumed by `GameShow.scss` and `Jeopardy.scss` — works only because all three stylesheets always co-bundle; move to a shared partial with the tokens (§3.4).
- `BuzzerBind` marks a team "bound ✓" the moment you *start* binding (`GameShow.jsx:40` sets `bound` in the click handler), not when a press is actually captured — lie in the UI if no buzzer press ever arrives; `bindingTeamId`-cleared is the real signal (`useBuzzers.js:27`).
- If `createSession` fails (`GameShow.jsx:72`), play continues (good) but the QR never appears and nothing says why the phone companion isn't available.
- `MediaCluePlayer` `<img alt="">` is fine, but audio clues render an invisible `<audio>` with no on-screen "🎵 listen…" affordance — a name-that-tune clue shows only the prompt text with no indication sound should be playing (deadly when combined with §6.1).
- Board tiles are `<div>`s (fine for the cursor model) but carry no `aria` at all; if that's a deliberate 10-foot-UI tradeoff, one comment saying so would stop future "fix" churn.

---

## 7. The host companion (quick pass)

Mostly sound: phase-aware controls from a pure, tested mapping (`hostView.js`), answers visible for judging, direct tile grid instead of a d-pad-on-a-phone (`SELECT_AT` — correct call), sticky action bar, `:active` press feedback, `-webkit-tap-highlight-color` handled. Issues, all minor relative to the TV side:

- **No error/ack path for commands** — `sendCommand` is fire-and-forget; if the TV rejects (stale phase) or the POST fails, the host gets no feedback and the state mirror just… doesn't change. A subtle "sending…"/failed toast would cover it.
- The host renders **team buttons for buzz designation even in `self` mode** (`GameShowHost.jsx:95` checks `mode !== 'turns'` but not `self`) — in self mode a buzz auto-reveals the answer on the TV (`jeopardyReducer.js:130`), so a host mis-tap spoils the clue. Should honor mode `hosted` only, or be labeled differently in self mode.
- Board tiles at `font-size: 1.1rem` with `0.7rem` category headers (`GameShowHost.scss:30-34`) are cramped on a 6-category set on a phone; categories truncate with no ellipsis handling.
- `gsh__done` ("Game over 🎉") is a dead end — no final scores on the phone, no "start another" affordance, even though the phone knows the scores.

---

## 8. What's genuinely good (keep it)

- **Architecture is the best part of this module**: pure reducers with real test coverage, one action funnel, game-agnostic shell with a registry (`games/registry.js`) — a second game (Family Feud etc.) genuinely could slot in.
- Resume lifecycle end-to-end (boot gate → checkpoint → finish) with graceful degradation at every seam (no session, no WS, no media, no audio — nothing crashes the game).
- The phone-as-host-console concept with QR onboarding is the right interaction model for this format, and keeping the TV authoritative is the right topology.
- Focus outlines everywhere, `data-testid`s everywhere, self-mode/turns-mode rule differences handled in the reducer where they belong.
- The board cursor + keymap (`keymap.js`) is a clean, testable TV-input pattern — it just needs to be extended to the shell phases (§2.1).

---

## 9. Prioritized recommendations

| # | Sev | Fix | Where |
|---|-----|-----|-------|
| 1 | Blocker | Roving focus / ActionBus nav for all shell phases (set-picker, team-setup, bind, wagers, final-judging, results) | `GameShow.jsx`, `TeamSetup.jsx`, `FinalRound.jsx`, `WagerPanel.jsx` |
| 2 | Blocker | Fit the board to the frame: `grid-template-rows: auto repeat(var(--rows), 1fr)`, drop tile `min-height`, clamp tile/category type | `Jeopardy.scss`, `Board.jsx` |
| 3 | High | Give the TV Daily-Double wager real state (mirror `FinalRound`'s `draft`) | `Jeopardy.jsx:159-167` |
| 4 | High | Register an escape interceptor while playing (Back = timeout/back-to-board, long-press or results-phase = exit); verify on Shield | `GameShow.jsx` + `ScreenOverlayProvider` |
| 5 | High | Vertical budget + length-responsive type for the clue screen; replace `50vh` with frame-relative units | `components.scss`, `Jeopardy.scss` |
| 6 | High | Palette pass: dark board well + genuinely dark used tiles; on-colors for team-colored surfaces; de-collide team-1 gold vs accent; extract tokens | all SCSS |
| 7 | High | Self-hosted display + clue faces; 5-step type scale | new `_tokens.scss` |
| 8 | High | Ship (or gracefully disable) the `classic` audio pack; add the missing visual beats (tile zoom, board fill, score count-up, DD splash, results ceremony) with `prefers-reduced-motion` guards | `AudioCueEngine.js`, components |
| 9 | Medium | Play-again keeps roster + bindings; QR moves to round-intro; TeamSetup single shared pool row + horizontal-overflow handling | `flowReducer.js`, `GameShow.jsx`, `TeamSetup.jsx` |
| 10 | Medium | Copy pass (§6.2), tie handling, labeled offline pill, arm-gated digit buzzing | misc |

**Bottom line:** the engineering skeleton is strong — clean state machine, resilient lifecycle, right host topology — but as a *product on the living-room TV* it currently fails its two defining constraints: a classic board doesn't fit the 16:9 frame it's bound to, and the couch remote can't get past the first menu. Fix items 1–3 and it becomes playable; items 4–8 are what make it feel like a game show instead of a wireframe of one.
