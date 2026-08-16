# Piano Chess — handoff to the prod agent

**Date:** 2026-08-16
**State:** all work is on `origin/main` and **nothing is deployed**. Every change below is unverified
on the device it was written for.

---

## Why this needs a prod agent

The whole body of work targets the **piano kiosk tablet** — a 2018 Samsung Galaxy Tab A (SM-T590,
`10.0.0.245`) running Fully Kiosk Browser. It was written and tested on a MacBook against jsdom and
a Vite build. Not one frame of it has been seen on the tablet.

The dev machine could not reach prod at all:

```
ssh homeserver.local
  sign_and_send_pubkey: signing failed for ED25519 "kckern.net" from agent:
    communication with agent failed
  root@10.0.0.10: Permission denied (publickey)
```

So deploy, container restart, and on-device verification are all still to do.

---

## Do this first

1. **Deploy** `origin/main` the usual way (prod builds from the homeserver tree at
   `/opt/Code/DaylightStation`). Integrate any unpushed homeserver work *before* building — see
   `CLAUDE.local.md`.
2. **Restart the container.** Household app config is cached at startup, and
   `data/household/config/chess.yml` changed (see *Config changes* below). Without a restart the
   opponent still answers at the old pace.
3. **Watch one real game on the tablet**, with a child if possible. The list of what to look for is
   below.

---

## Config changes needing a restart

`data/household/config/chess.yml` gained an `opponent.think_ms` block:

```yaml
opponent:
  think_ms:
    floor: 1200
    ceiling: 4000
    jitter: 0.15
```

**Why.** The shared house curve (`opponentPacing.js`) floors at 600ms, which is right for Connect
Four and Checkers. At chess's level 0 it produced replies in **462-707ms** — faster than the 700ms
constant that was reported as "the opponent moves too fast to see", and the bottom of the ladder is
exactly where the youngest players are. 1200 is the readability floor; the ceiling is untouched, so
a strong character still visibly broods longer than a weak one. Jitter is tightened from 0.25 so the
floor actually holds (at 0.25 a level-0 reply could still dip to 925ms).

**This is a judgement call, not a fact.** It is the one number most worth changing in the room.

---

## What to look for on the tablet

### The reported jank
Users reported lag when the board lights up. Four causes were found and fixed; the fix is
**unverified on hardware**:

- A single move generation per position instead of two-to-four `new Chess(fen)` per render, on a
  path that runs for every MIDI note on *and* off (a held chord is 3-5 events in ~100ms).
- The same call was also running inside the cursor clock at 40Hz while keys are held.
- `Square` is memoized and the board's props have stable identities, so `memo(ChessBoard)` can
  actually bail — previously 64 subtrees and ~32 images reconciled per note.
- `transition: box-shadow` removed from squares, and the held-square marching ants (an animated
  `background-position`, repainting for the *whole* hold) replaced with an opacity pulse.

**Check:** hold a 3-4 note cluster and sweep through chords. The candidate rings should snap with no
stutter. If it still janks, profile before changing anything — the box-shadow diagnosis is sound
mechanism but was never measured on the device.

### New animation, on a WebView documented to throttle
All of these are new and all are transform/opacity only, but they have never run on the tablet:

- pickup lift, landing settle, capture fade-out, opponent glide (420ms vs the player's 180ms)
- held-square breathe (only while holding), thinking pulse (only while thinking)
- opening banner, result overlay, mated-king topple, promotion reveal, win confetti (20 sprites)
- rim sweep on a chord re-deal, first-game walkthrough card

**Check:** an aged page (leave it open 10+ minutes) still animates at rate. The app-level keep-alive
crawl in `PianoApp.scss` **must not be removed** — this WebView demonstrably throttles compositing
without a standing animation.

### Sound — most likely thing to be wrong
The board now speaks: move, capture, refusal, check, promotion, win, loss. Synthesised WebAudio, no
assets. **It defaults ON**, in front of a piano a child is actively playing.

This may simply be a bad call. There is a Sound on/Silent toggle in the chess settings panel.
**Ask the kids.** If it intrudes, flip the default in `chessCues.js` (`feedback.sound`).

### Everything else worth a look
- The clock (top of the state rail). Count-up by default; nothing forfeits on time.
- The identity row — whose game, whose turn, which colour. None of that was on screen before.
- The captured rail now draws piece **artwork**. It previously used unicode chess glyphs, which this
  WebView renders as tofu — so it was probably broken in the field. Confirm it is not.
- The first-game walkthrough shows once per player and writes `seen_intro` to their config. Test
  with a child who has not played.
- "Show that again": **five** adjacent semitones rewinds the last exchange and replays it at half
  speed. Free, never charged as help.

---

## Known-unfinished, with the reasoning

### The upper ladder is spaced by construction, not measurement
Levels 0-8 are the homegrown teaching opponent and **are** grounded in data. Levels 9-20 are
Stockfish and are not.

Two calibration runs, at reference depth 12 and depth 20:

| Skill | 0 | 4 | 8 | 12 | 16 | 20 |
|-------|---|---|---|----|----|----|
| ACPL @ depth 20 | 132 | 106 | 113 | 108 | 105 | 108 |

At depth 12 everything collapsed to ~34 — that was the reference saturating. At depth 20 the numbers
rose to ~110 (so it is finding real fault) **and the rungs still did not separate**: skill 4 through
20 sit inside 8cp of each other.

The honest conclusion is that **at 400ms per move, Stockfish's skill dial barely moves on positions
from real games.** Movetime is doing the work, not skill. Before re-spacing levels 9-20, sweep across
*movetime* rather than skill, and over more than 40 positions:

```bash
npm run chess:calibrate -- --skills 0,4,8,12,16,20 --positions 120 --depth 20
```

This matters less than it sounds: no child in this house is near level 9.

### Not built, deliberately
- **Material odds** as a second ladder axis — only needed if more than the current nine child rungs
  are wanted. Needs a non-standard `initial_fen` and a board that says why.
- **Loss on time.** The clock displays and flags; nothing ends a game. It was not asked for, and
  wiring a synthetic result through the game-over, archive and promotion paths for an unwanted
  feature is not a good trade.

---

## Traps this work fell into — worth knowing before touching it

1. **The archive moved and only the writer followed.** The household reorganisation relocated played
   games from `household/history/gaming/pianochess` to `household/gaming/log/pianochess`. Both review
   CLIs kept reading the old path and reported "no archived games" for a corpus of 32 sitting one
   directory away. The path now lives in `shared/gaming/chess/archivePaths.mjs`, imported by the
   writer and both readers, and the readers now **throw naming the directory**. A stale path that
   reads as an empty result is worse than one that fails.

2. **The local checkout was 56 commits behind `origin/main`.** Exactly the trap `CLAUDE.local.md`
   warns about. Upstream had independently built `opponentPacing.js`, and it is **better** than what
   was written here — a platform capability shared by three games, rung-scaled with seeded jitter.
   It was adopted wholesale. Check for unpushed homeserver work before starting.

3. **Merging created a duplicate `animation` declaration** on the thinking pulse, and the later one
   won — silently discarding the rung-scaled duration that is the entire point of the upstream
   design. Two tests now guard this, including one sweeping the board stylesheet for any selector
   declaring `animation`/`transform`/`transition`/`box-shadow` more than once.

4. **The push guard only gates *added* lines.** Real household names on pre-existing lines survived
   into a public repo until they were found by hand. Worth a sweep beyond chess.

---

## Pre-existing breakage found along the way (not caused by this work)

- `backend/src/4_api/v1/routers/piano.courses.test.mjs` fails **20/20 at pure `origin/main`** with
  `createPianoRouter: pianoContainer required`. Verified against a clean tree. Main is red.
- `npm run audit:layers` reports 5 regressions against baseline (`api-no-apps`, `api-no-domains`,
  `api-handrolled-500`, `apps-success-false`, `domains-tojson`). Verified identical on a clean tree
  before any of this work.
- One test in `StockfishEngineAdapter.test.mjs` is timing-sensitive and fails under a full
  300+-file parallel run while passing in isolation. Not a real failure, but it will look like one.

---

## Verification status

- **3,757 tests pass** (vitest) plus 38 node:test, frontend build clean.
- Everything above is **jsdom and CI only**. Nothing has run on the tablet.
