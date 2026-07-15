# Game Show Shell + Jeopardy

A generic **Game Show** shell (`frontend/src/modules/GameShow/`, screen-framework
widget `gameshow`) with **Jeopardy** as its first game. The shell owns everything
game-agnostic — team setup, buzzers, scoreboard, timers, audio, shared components —
and games plug in via `games/registry.js`. Full design: `docs/superpowers/specs/2026-07-14-gameshow-shell-jeopardy-design.md`.

**Architecture in one paragraph:** the frontend reducer is authoritative during play and
checkpoints every transition to a backend session store (`data/household/state/gameshow/sessions/`)
so a kiosk reload can resume. Config comes from `data/household/config/gameshow.yml`
(team presets hydrated via UserService); content sets from `data/content/games/jeopardy/*.yml`;
media (sound packs + clue assets) is served through `GET /api/v1/gameshow/media/*`
(raw `/media/*` is not served by the app). Buzzers arrive over MQTT via the existing
`MQTTSelectorAdapter` and a mobile host companion drives the game from a phone over WebSocket.

## Game set schema — `data/content/games/jeopardy/<set-id>.yml`

```yaml
id: bible-night-1              # required, [a-z0-9-]; also the filename
title: "Scripture Showdown"   # required
description: "Family trivia"  # optional
rounds:                        # required, non-empty
  - name: Jeopardy             # optional (defaults "Round N")
    mode: hosted               # hosted | self | turns   (default hosted)
    multiplier: 1              # value multiplier (Double Jeopardy: 2). default 1
    timer_seconds: 12          # optional per-round clue timer (overrides gameshow.yml default)
    penalize_wrong: true       # deduct on wrong answer? default true
    categories:                # required, non-empty
      - name: "Old Testament"
        clues:                 # required, non-empty
          - value: 100         # required, positive number
            clue: "He built an ark"   # required
            answer: "Who is Noah?"    # required
          - value: 300
            clue: "Name that tune"
            media: { type: audio, src: "games/jeopardy/bible-night-1/hymn.mp3" }  # optional
            answer: "What is 'Amazing Grace'?"
            daily_double: true         # optional, default false
final:                         # optional; omit to skip Final Jeopardy
  category: "Prophets"
  clue: "This prophet was swallowed by a great fish"
  media: null                  # optional { type, src }
  answer: "Who is Jonah?"
```

- **`mode` per round** — `hosted` (teams buzz, host judges; wrong re-arms the rest),
  `self` (buzz → answer auto-reveals → single confirm), `turns` (active team answers,
  rotation advances every clue; no buzzers).
- **`media`** is optional on any clue and on `final`: `{ type: image|audio|video, src }`,
  where `src` is relative to `media/apps/` (e.g. `games/jeopardy/<set>/pic.jpg`).
- **5×5 is convention, not enforced** — any number of categories/clues works.
- Malformed sets appear **disabled** in the set picker (with the first validation error),
  never crashing the shell.

A complete, playable sample with no media files is in `sample-set.yml` (deploy it to
verify an install).

## Config — `data/household/config/gameshow.yml`

See `sample-gameshow.yml`. Keys:

- `buzzers: [{ id, mqtt_topic, buttons: { "<zigbee-action>": "slot_N" } }]` — zigbee2mqtt
  buttons mapped to team slots (same shape as fitness `selectors:`). Empty is fine — buzzer
  modes stay playable without hardware (see below).
- `team_presets: [{ id, name, teams: [{ name, color, members: [<username>] }] }]` — members
  are UserService usernames, hydrated to `{ id, name, avatar }`. Editable at game start.
- `defaults: { timer_seconds, mute }`, `sounds: { pack }`.

## Sound pack contract

Packs live at `media/apps/gameshow/<pack>/` and the engine plays `<cue>.mp3` by name.
Cues used by Jeopardy: `buzz`, `correct`, `wrong`, `reveal`, `board-fill`, `daily-double`,
`think`, `win`. **Missing files are silent no-ops**, so an empty pack is valid — the game
plays silently until you add sounds. The `clue-media` channel auto-ducks any looping
`think` music so name-that-tune clips aren't drowned out.

## Mobile host companion

The host can drive the game from a phone instead of (or alongside) a gamepad:

- During play the TV shows a **QR code** (bottom-right) linking to
  `/gameshow/host/<sessionId>`. Scanning opens the phone control surface, already bound to
  the live session.
- The TV stays **authoritative**. The phone is a thin remote: it mirrors live state over
  WebSocket (`kind:'state'`) and sends commands via `POST /api/v1/gameshow/sessions/:id/command`
  (`kind:'command'`), which the TV applies through the same path as keyboard/gamepad input.
- Phase-aware controls: a **tap-any-tile board picker** (`SELECT_AT`), Reveal / Time-out,
  **Correct / Wrong** judging, per-team "answers" buttons (no-hardware buzz-in), wager
  steppers, and per-team Final judging. The current clue's **answer is shown on the phone**
  so the host can judge without reading the TV.

## Playing without buzzer hardware

- **Keyboard digits 1–9** buzz slots 1–9 on whatever screen has focus.
- **`POST /api/v1/gameshow/buzz`** `{"slot":"slot_1"}` injects a buzz (debug/testing).
- The **phone companion's** per-team "answers" buttons designate who answers.
- **Gamepad** d-pad/Enter/Escape drive host controls (GamepadAdapter synthesizes those keys).

## Deploy steps (kckern-server)

Files live on the data volume, written as the container user (never `sed -i` — write whole
files):

```bash
# 1. Household config
sudo docker exec daylight-station sh -c "cat > data/household/config/gameshow.yml << 'EOF'
$(cat docs/reference/gameshow/sample-gameshow.yml)
EOF"

# 2. A game set
sudo docker exec daylight-station sh -c "cat > data/content/games/jeopardy/sample-family-night.yml << 'EOF'
$(cat docs/reference/gameshow/sample-set.yml)
EOF"

# 3. (optional) a sound pack — drop <cue>.mp3 files into:
#    media/apps/gameshow/classic/{buzz,correct,wrong,reveal,board-fill,daily-double,think,win}.mp3
```

Point a screen config at widget `gameshow` (or add it to a menu) to launch. After editing
`frontend/src/modules/GameShow/`, rebuild + redeploy and reload the target kiosk.

## AI game-set generation prompt

Paste this into any chatbot to generate a new set (edit the topic/round asks first):

```
Generate a Jeopardy game set as YAML for a family game night about <TOPIC>.

Output ONLY valid YAML (no markdown fences, no commentary) matching this schema:
- Top level: id (kebab-case), title, description, rounds (list), final (object).
- Each round: name, mode (one of hosted|self|turns), multiplier (1 for round 1,
  2 for a Double round), categories (list).
- Each category: name, clues (list of 5).
- Each clue: value (100,200,300,400,500 by difficulty), clue (the statement/prompt),
  answer (phrased as a question, e.g. "What is ...?" / "Who is ...?").
- Mark exactly ONE clue per round with `daily_double: true`.
- final: category, clue, answer.

Make 2 rounds of 5 categories x 5 clues, family-friendly, factually correct.
Do not include a `media` field. Output only the YAML.
```
