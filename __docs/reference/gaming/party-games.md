# Party Games Environment

`party-games` is the environment for co-located people sharing a primary display. It owns team setup, controller-role binding, buzzer arbitration, host and verifier companions, audio/AI/print effect policies, and household sourcing. Experiences provide rules, projections, and experience-specific presentation such as Activity Party's drawing canvas. Common visual primitives and normalized input adapters live in the Gaming platform.

The environment mounts an experience through `PartyGamesExperience`, which injects `gamingServices` capability ports. Jeopardy can arm and subscribe to buzzers or play named audio cues without importing Party Games. This keeps the same experience portable to School, Piano, developer, or future surfaces with different capability implementations.

The Party Games catalog also exposes each mounted experience's `theme`, `input_profile`, `lifecycle_capabilities`, and declared inputs. Setup is capability-driven: ordinary games proceed directly from player selection, while only experiences declaring `input_profile.gamepad: host-and-buzzer` enter controller binding. A completed experience returns a normalized `gaming-result/v1` result to the shell. Both ordinary `?session=` links and ephemeral `?diagnostic_session=` links can attach and resume; a completed resume goes directly to the terminal result instead of recreating the game.

TV and companion presenters share two import aliases: `@gaming` resolves to the Gaming module root and `@gaming-ui` resolves to its primitive layer. Vite and Vitest own the same mapping so production and tests cannot resolve the architecture differently.

Jeopardy and Activity Party use the direct Gaming coordinator. Activity Party supports Draw and Charades, performer-ready gates, rounds, deterministic timers and rotation, host modes, progressive reveals, score adjustments, and verifier confirmation for subjective hostless outcomes. Drawing checkpoints are transient and are deleted when an outcome commits.

Charades is also mounted as a focused Party Games experience with a seeded,
deterministic clue bank. Its reusable sixteen-segment text decoder
(`SegmentedSecretText`) lights every segment of every cell, spaces included, so
word boundaries do not show without the decoder. Clue lines balance at word
boundaries without truncation.

Letter segments use warm colors whose red channel is full (white, yellow, peach,
pink, orange, magenta, hot pink, red). All other segments use cool colors whose
red channel stays at or below `0x40` (aqua mint, cyan, green, sky, teal, forest,
blue, jet black). Jet black gives the mask a dark member, so the greens and
blues are not the only colours around the letters. A red filter keeps the warm
segments bright and darkens the cool ones. The two families overlap in apparent
brightness, so brightness alone does not mark the letters. Hex values live in
`platform/ui/_tokens.scss`, the family lists in `segmentedSecretPalette.js`,
and `segmentedSecretPalette.test.js` fails if a color breaks the red-channel
rule.

By default, the clue is animated continuously. One engine in
`SegmentedSecretText` runs on a single clock. Each step it decides which letters
show, lights those letters' segments warm and everything else cool, and—when
`color_animation` is enabled—gives every segment a new color. Every `motion_ms`
it also jumps the card when `motion` is enabled. Three reveal modes
(`segmentedSecretReveal.js`):

- **progressive** — a typewriter loop. It starts with a cursor, the
  cell's two bottom segments lit warm, then adds one character per step with
  the cursor moving ahead. Once the whole clue shows, it hides first-to-last at
  the same pace, then starts again. Lines are typed in reading order.
- **marquee** (default) — each line scrolls right to left through its own cells: in from
  the right, held fully visible, out to the left, then an empty gap before it
  comes round again. Lines share one schedule sized to the longest.
- **static** — the whole clue, always. With the animated defaults, colors
  shuffle with the position jump.

A hidden letter is never a blank cell: its cell stays fully lit in mask colors,
so the clue's length and word gaps never show. The cursor is warm, so it also
shows only through the red card. The engine is a layout effect, so the first
frame (cursor only) is on screen before the browser paints and the clue never
flashes up.

The display is configured per game under `decoder:` in its rules file
(`gaming/games/<id>/rules.yml`). Every key is optional; missing keys take the
defaults in `DECODER_DEFAULTS`:

| Key | Default | Meaning |
|---|---|---|
| `reveal` | `marquee` | `marquee`, `progressive` or `static` |
| `step_ms` | `100` | one reveal or scroll step and one color shuffle (static mode shuffles every `motion_ms`) |
| `motion` | `true` | jump the card's position |
| `motion_ms` | `100` | time between position jumps (every step at the defaults, so the card jumps in sync with the scroll) |
| `color_animation` | `true` | recolor segments within their signal/mask family on decoder steps |
| `marquee_hold_steps` | `10` | steps held fully visible (1s at the defaults) |
| `marquee_gap_steps` | `4` | empty steps before the text comes round again (a four-glyph gap) |

The Activity Party ruleset validates the block (`validateActivityPartyDefinition`
fails closed on a bad value) and projects it to the screen as authored. Charades
and Activity Party pass it to the decoder. `/dev/decoder-swatches?mode=marquee`
(or `progressive`, `static`) tries a mode on the live sample.

For text that is fully revealed and entirely inert, configure all three axes:

```yaml
decoder:
  reveal: static
  motion: false
  color_animation: false
```

This disables the text decoder's reveal, position, and color clocks. It does
not change `ImageDecoderDisplay`; image clue animation is configured and tested
separately.

The position follows `ImageDecoderDisplay` (`segmentedSecretMotion.js`): the
card alternates between −2% and +2% of its own width, so every jump moves it
most of a glyph, with a seeded vertical offset within ±10% of its height. The
path is seeded by the clue and restarts with each new clue. It snaps rather than
glides. The offsets are small because the card is nearly the full stage width:
the image decoder's ±35% would push it off the TV.

A color change never crosses families, so the view through the filter is
constant. Letter segments that touch — ends meeting at a joint, including pairs
split by the middle joint such as the upper and lower right side
(`SEGMENT_NEIGHBORS`) — never share a color: not on first draw, not after a
step, and not when a new clue reuses a segment. Segments are recolored in order,
each avoiding the colors its touching lit neighbours hold at that moment
(`nextColorIndex` in `segmentFlicker.js`). Position and colors are written
straight to the DOM rather than re-rendering glyphs. Under
`prefers-reduced-motion` every mode shows the whole clue, centred, with the
colors still.

`/dev/decoder-swatches` shows every palette color and a live sample; open it on
the target screen and hold up the physical red card to confirm each warm bar
stays bright and each cool bar goes dark. The segment geometry is code-rendered;
no font binary is bundled.

Image clues use pale cyan art beneath a full-field colored texture, rings,
bubbles and crossing streaks. All interference pigments preserve the red channel,
so the simulated red-filter view retains the original image detail. The image
renderer does not flash the clue or change its visibility over time.

`GamepadAdapter` preserves ABXY/LR identity and binds a stable controller ID to a semantic role on press. The Gaming platform's `DrawingTabletAdapter` emits Pointer Event pressure and eraser metadata with touch/mouse normalization. It converts responsive CSS coordinates into the canvas backing-store coordinate system, clamps captured strokes to the canvas, and preserves independent pointer identities. Browser input is hosted by screen-framework and translated to `InteractionIntent` before experience code sees it.

### Anonymous teams and turn-based Jeopardy

A team-based definition can author `party_games.anonymous_teams` (at least two
`{name, color}` entries, with six-digit hex colors) and a nonempty
`party_games.setup_revision` in its rules artifact. The catalog projects these
into `setup_profile`; setup starts with those teams, hides household roster and
guest entry, and focuses Start. Teams carry empty member lists and ordinary
sequential IDs/slots; additional anonymous teams can be added or removed down
to two. The host can operate setup and the whole game with the TV remote.

When every Jeopardy round uses `mode: turns`, its projected gamepad profile is
`host`, so Party Games skips hardware readiness. This explicit noncompetitive
mode keeps its active-team rotation. Hosted/self and mixed packs require one
connected, assigned, tested physical gamepad per team before Start. Phone host
controls select, reveal, judge, and manage wagers; TV navigation does not issue
those commands.

A clue marked `little_kids: true` receives a fixed `assigned_team_id` when the
session initializes. Flagged clues are distributed across teams in round,
category, then clue order, independently of price or selection order. Both boards
show the owner; opening a flagged clue grants that team the answer, disables
buzzing, and waits for host judgment without a countdown. A miss closes under
host control with no steal. The little-kids assignment takes precedence over a
Daily Double marker. Ordinary hosted clues retain the first-buzz race and steals.
Restored older boards acquire the same deterministic assignments without
changing scores or used clues. Public projections retain owner badges while
hiding unopened prompts, answers, Daily Doubles, and physical controller IDs.

Automatic local-session recovery compares the pinned definition's
`party_games.setup_revision` with the current catalog. An older saved session
is discarded locally so it cannot silently replace new anonymous defaults;
explicit session links remain attachable and refresh preserves the current
session. Change the revision when replacing a preset's setup policy.

### Remote usability and recovery

`GameButton autoFocus` and the team/wager confirmation controls carry a
`data-remote-autofocus` DOM marker. React's `autoFocus` alone does not leave an
HTML autofocus attribute. Scoped remote controls use that marker after focus
loss or window activation; OK therefore returns to the intended primary action
instead of activating the first incidental button. A first directional press
with no eligible focus restores the primary focus. Anonymous team edits return
focus to Start, and held OK presses cannot keep adding teams.

Left invokes an experience’s registered Back action or moves focus among shell buttons. Escape/Back opens the shell’s leave confirmation. Jeopardy gameplay is controlled from the phone host: TV arrows, Enter, and board clicks never select, reveal, judge, or change wagers. Hosted/self games still accept physical team buzzers. Turns games skip buzzer setup.

A failed game request exposes a focused Retry connection button. Retry loads
the authoritative session rather than replaying a command that may already
have committed. Game commands are suspended while the recovery screen is up.
Acknowledged state is available to subsequent input before React's next paint,
so a fast second press cannot judge the previous clue again. Completed Final
judgments and locked wagers reject duplicate submissions in both the presenter
and authoritative rules.

### Remote keys inside the shell

`PartyGamesApp` owns the TV remote through `useScopedRemoteControls`. Experiences can register a handler through `registerRemoteAction(handler)`; unclaimed input falls through to shell focus and leave behavior. Jeopardy registers no gameplay handler. Phone buttons retain ordinary keyboard activation and focus accessibility.


### Gamepad buzzers

The TV's **Ready to play** view keeps the host QR visible and guides each team
through an assignment press followed by a released, fresh test press. Assigned
and Tested are separate statuses shared with the phone. A controller already
assigned to another team cannot be stolen. Start/Back and all other gamepad
inputs are captured by the existing shared `GamepadAdapter` during setup; there
is no second gamepad poller. The phone can reassign a team and must wait for the
TV to assign/test its new mapping.

The session owns `buzzerSetup` (`epoch`, `seenAt`, per-team `generation`, `slot`,
`connected`, `tested`). TV mounts reset all live tests. Disconnect invalidates
the team's test and advances its generation; reconnect requires a fresh press.
Saved roles do not count as a current test. TV presence renews every five
seconds; a fifteen-second absence disables phone Start and the authoritative
server Start gate. The server uses its recorded command time, never the client's
timestamp, for this lease. Every round in a mixed pack participates in readiness,
so a later competitive round cannot bypass the gate.

The host-only Jeopardy commands are `BUZZER_SETUP`, `BUZZER_PRESENCE`,
`BUZZER_REPORT` (`assign`, `test`, `disconnect`), and `BUZZER_REASSIGN`. Reports
must match the TV epoch, team generation and slot; stale reports and participant
attempts are rejected. `START_ROUND` returns `buzzers_not_ready` (HTTP 422)
until every required team is ready. Arbiter slots are `gamepad:<index>:<id>`;
ordinary keyboard/WS buzz inputs cannot satisfy physical-gamepad readiness.
Team-bound controllers remain buzzers during play and return to navigation on
exit. Host phone answer controls remain available for ordinary competitive clues.

On the board the canonical chooser appears prominently as **[Team] — choose
the next question**, with team color. A newly observed selection keeps the board
visible and lights the selected tile for exactly 500 ms before showing its clue
or wager. All local buzzer sources remain disarmed during that acknowledgment.
Direct refresh into a clue skips the animation; score-only snapshots do not
replay it, and session/round changes and unmount cancel stale timers.

### Jeopardy sound pack

Jeopardy plays its cues from the `jeopardy` pack, `media/games/party-games/jeopardy/<cue>.mp3`, served at `/api/v1/gaming/media/jeopardy/<cue>.mp3`.

| Cue | Channel | When |
|---|---|---|
| `theme` | music (loops, 50%) | round title card |
| `board-fill` | sfx | the board fills |
| `reveal` | sfx | a clue is picked |
| `daily-double` | sfx | the wager screen opens |
| `buzz` | sfx | a team buzzes in |
| `correct` / `wrong` | sfx | the host judges, including Final Jeopardy |
| `time-up` | sfx | the clue timer runs out |
| `think` | music | Final Jeopardy clue |
| `win` | sfx | game over |

A missing or unplayable file logs `party-games.audio.play_failed` and the game continues silently.

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

## Casual family Charades

A Charades definition can set `competition: false` to play without scorekeeping,
rankings, correctness questions, verifier steps, or AI commentary. The catalog
projects individual setup for this mode while preserving the experience's team
capabilities for competitive definitions. The rule setting controls behavior;
hiding a scoreboard alone is not casual mode.

Reusable games should be named YAML definitions (presets). A menu invokes only
the preset reference:

```yaml
- label: Charades
  input: app:party-games/charades:fhe
  action: Open
```

The living-room FHE screen also exposes stable direct routes:

- `/screens/living-room/fhe/charades` launches the recorded game.
- `/screens/living-room/fhe/charades/test` launches the same preset with clue
  history disabled. Test sessions neither read exclusions nor emit history
  entries, and use a separate browser resume slot from recorded sessions.

Both routes retain their friendly path while the session is active. Back exits
to `/screens/living-room/fhe`.

The preset directory is `household/gaming/games/charades:fhe/`. Its `rules.yml`
owns rounds, timing, clue count, competition, decoder participants and music,
plus launch defaults:

```yaml
launch:
  autostart: true
  participants: [person_a, person_b]
```

Its `content.yml` references the reusable bank and selects categories/difficulty:

```yaml
clue_bank: charades/choices.yml
clue_filter:
  categories: [animals, everyday-actions]
  levels: [easy]
```

Bank entries may declare `category` and `level`. Filters combine both dimensions;
omitted dimensions allow all values. Invalid filters or an empty selected pool
fail visibly. Filtering happens before hashing and pinning, so a saved session
retains its selected clues after preset or bank edits.

The catalog projects preset launch defaults for both menu deep links and the game
picker. IDs resolve against the live household profile; missing, duplicate or
unknown IDs fail instead of selecting different players. A saved session takes
precedence on refresh. Normal setup remains available without automatic start.

Inline `?autostart=false` or `?participants=person_a,person_b` remain optional
per-field overrides. Reusable configuration belongs in the preset; loading one
does not expand its roster into the browser URL or admin menu input.

Authored content may reference a clue bank beneath the configured data root:

```yaml
# household/gaming/games/<definition-id>/content.yml
artifact: { kind: gaming-content, version: 1, id: "<definition-id>" }
title: Family Charades
clue_bank: charades/choices.yml
catalog:
  description: Act together, just for fun
  round_count: 3
```

The bank lives at `content/games/charades/choices.yml`:

```yaml
version: 1
clues:
  - id: rabbit
    text: Rabbit
    category: animals
    level: easy
    image: images/rabbit.svg
  - id: swimming
    text: Swimming
    category: everyday-actions
    level: easy
```

Images are relative to the bank directory. Paths must remain inside that
directory, including after resolving symlinks. The loader validates clue IDs,
text, and image files and compiles them into the content artifact before hashing
and pinning. Editing the bank changes newly created games; already pinned
sessions retain their clue content and archived image bytes. Read-only catalog
and diagnostic loads do not archive images; their URLs verify the current image
hash. Only image formats are served from this namespace. Image URLs use
`/api/v1/gaming/media/content/<sha256>/<game>/<relative-image>`; the configured content
root is distinct from the legacy Party Games sound/media directory.

The corresponding rules use `rounds`, `timer_ms`, `clues_per_turn`,
`turn_selection: seeded-rounds`, and `presentation.image_participants` for the
household's image-player IDs. Image and text-only pools are separate, so word
turns cannot consume picture clues needed by young players.

Completed casual Charades turns are recorded in
`household/gaming/history/charades.yml`. New sessions consume the unused clues
in each presentation pool before beginning a fresh cycle; the image and text
pools exhaust independently, and a clue is not repeated merely because old
session snapshots or replay journals still exist. The session captures the
history it selected against, so replay remains deterministic when the ledger
later grows.

To replace only the FHE ledger with one reviewed completed session, first run a
dry-run and inspect its ordered IDs, then apply it:

```bash
npm run gaming:charades-history -- reset-fhe --from-session '<session-id>'
npm run gaming:charades-history -- reset-fhe --from-session '<session-id>' --apply
```

The apply form creates a timestamped sibling backup when a ledger already
exists and preserves sections for other definition IDs. This command is a
narrow migration tool; ordinary completed turns append automatically.

Casual play requires a `guessing_music` rule setting containing a
`source` content reference and local `volume`. The Party Games environment
resolves that reference through the standard queue endpoint.
`repeat: after-cycle` advances through the shuffled bag when a track ends.
`repeat: one` assigns one shuffled track to the authoritative turn and loops
that track until guessing ends. With `memory: session`, both the remaining bag
and the turn assignment survive a page refresh, so resuming a turn does not
change its music. Volume is a 0..1 definition value multiplied by the screen
master volume.
Definitions without those fields retain per-start random selection. Playback
stops and cancels pending work when guessing ends or the experience unmounts.
The source must be authored in configuration, never embedded in presenter code.

Decoder reading is untimed. A fresh remote OK starts guessing. Casual early
finish does not claim the answer was correct; expiry and early finish both
reveal the clue without adjudication. Verify the complete flow with
`tests/live/flow/gaming/fhe-charades.runtime.test.mjs`, selecting the target
server through `BASE_URL`. That test uses real media and remote keys. Physical
red-card readability still requires assessment on the intended display;
rendered SVGs and successful HTTP responses alone do not establish it.

The Jeopardy phone controller offers an inline-confirmed **Restart game** utility in every phase, including results. Restart creates a new session from the current authored definition with the same teams and participants; scores, used clues, and wagers start empty. The original pinned session and journal remain available. Diagnostic restarts use process-memory sessions and never create durable history. The host-only `POST /api/v1/gaming/sessions/:sessionId/restart` returns the new session and broadcasts `{topic: "gaming", kind: "session-restarted", sessionId, replacementSessionId}` for attached screens to follow. Repeated restart requests for the same source return its existing replacement. GET of that source exposes optional `replacementSessionId`; phone and TV follow it on boot and reconnect, including missed broadcasts or a lost POST response. Ordinary handoffs persist in separate atomic sidecars under `gaming/restarts`; diagnostic handoffs stay exclusively in process memory. The old session journal is unchanged. Retry after an error refetches state and never replays a mutation.

Open-book practice packs use separate `gaming-rules` and `gaming-content` artifacts with the same definition ID. Keep `party_games.setup_revision` and anonymous Blue/Gold team metadata in rules; put `open_book: true`, boards, Final, and each clue’s `scripture_reference` in content. Use short supported prompts, distinct passages, and review every clue and answer against every other tile because the host may select tiles in any order. Two untimed turns rounds use five categories of 100/200/300 clues, multipliers 1/2, no wrong-answer penalty, and one Daily Double per round. Mark the first round’s five 100 clues `little_kids: true`.

The reviewed Isaiah fixture is `tests/_fixtures/group-play/isaiah-practice/{rules.yml,content.yml}` with definition ID `jeopardy:practice-isaiah`. Stage and validate both artifacts before installing them with the gaming artifact workflow. Once installed, launch `/screens/living-room/party-games/jeopardy:practice-isaiah` and scan the phone controller QR code. The phone host selects, reveals, and judges; the shared display shows the clue and scripture reference for family lookup. Content updates apply to newly created sessions; existing pinned sessions retain their original pack.


### Open-book Jeopardy on TV

Scan the prominent opening QR code to open the phone host, then tap **Start game** there. The QR disappears once play starts; the TV uses its full stage for the board and clues. Select tiles, lock Daily Double/Final wagers, reveal answers, and judge from the phone. The first round’s youngest-player cues remain visible, and used phone tiles keep their fixed height and row position.

Content may set `open_book: true` and add `scripture_reference: "Jeremiah 1:5"` to regular clues and Final. TV readers see the prompt, **Look up:** reference, then the revealed answer in reading order. Final’s question/reference remain hidden during category and wagering. References are optional; legacy null or absent references add no line. Open-book clues wait without a countdown until the host reveals/judges. Existing pinned sessions retain their original pack and timing; content changes apply to newly created or restarted sessions.

**Learn notes.** A regular clue or Final may also carry `learn: { text, ref?, translation?, note? }` — the passage itself, where `scripture_reference` only names it (`text` required, the rest optional strings; a malformed note fails validation, including `final.learn.text is required`). Participants receive it only with the answer. Once the answer is up and no judgment is owed — v2 answer review after Correct/Wrong, a v1 revealed clue, or Final judging — the phone host shows **Read the verse**; the TV then shows the note (`LearnCard`) in the clue's place until **Hide verse** or **Next question**, which closes it. `SHOW_LEARN`/`HIDE_LEARN` are host-only, idempotent and need no command context. A clue without a note shows no button.

Restart preserves the same teams and their saved physical buzzer roles, clears the arbiter’s prior locks by remounting the experience, and moves both phone and TV to a fresh opening lobby. Confirm/cancel is available during play and completed results. TV results offer Exit; the phone host owns Restart game.

For isolated browser acceptance, run `node tests/_lib/jeopardy-acceptance-server.mjs`, then set `BASE_URL` to its printed loopback URL before running the focused `fhe-jeopardy.runtime.test.mjs` browser suite. `BASE_URL` disables automatic backend startup. The harness mounts real Party Games TV/host surfaces, fonts, router, gaming diagnostic authority and WebSocket events; sessions are ephemeral and cleaned up by the tests. The default diagnostic mode starts no household services or durable games. For durable acceptance, set `JEOPARDY_ACCEPTANCE_DURABLE=1 JEOPARDY_ACCEPTANCE_PORT=3337` and run `jeopardy-reliable-input.runtime.test.mjs` against its printed loopback URL. That mode uses real journal/checkpoint repositories and pinned definitions in a disposable temporary directory; shutdown removes it. It exposes only its installed Jeremiah catalog entry and reports isolation through `/__jeopardy_acceptance`. Set `GAMING_ACCEPTANCE_MEDIA_ROOT` to a read-only reviewed media directory to exercise real clips. The harness serves reviewed local authored art through the production gaming media service and does not exercise the outer screen renderer or physical kiosk/buzzer hardware.

Embedded admin previews ignore ambient URL session attachments and leave the admin URL unchanged. Direct game routes validate attached definition identity against the requested pack.


### Opting an unstarted pinned practice session into competition

Changing authored round modes affects future sessions; an attached session keeps
its pinned set. For an explicitly selected unstarted practice session, the host
may send `jeopardy.configure.competitive` through the ordinary session command
endpoint. This converts its rounds to `hosted` and resets readiness while keeping
the session ID, teams, scores, QR and question pack. It is rejected unless the
session is at the first round introduction with no used clues and all scores
zero. It is not exposed as a general phone workflow and never changes an
in-progress/scored session. Unrelated authored `turns` packs retain that mode.


New sessions persist `setup.jeopardy_input_version: 1`. Scoped commands capture the original phase, question, attempt, answerer, choosing team and Final progress. Known revisions avoid an extra GET. A lost acknowledgement retries the identical envelope; an explicit revision conflict updates only its revision while the captured context still matches. A stale question or answering turn refreshes the view and cannot retarget an old action. Missing protocol metadata preserves exact historical behavior. The host-only `ENABLE_RELIABLE_INPUT` command opts an idle, nonterminal session in explicitly.

Client writes are organized by session and captured context, so an old outstanding request cannot discard the first press on a new clue. Server operations serialize per session. The local first-winner lock belongs to a stable question/attempt window; presence snapshots cannot reset it. Bound pads use independent controller identities, including identical model strings. Fresh observed release/repress edges remain eligible across window opening, while the separate unbound phantom guard prevents mirrored navigation. Early or held presses never buffer into a new attempt.

The TV gives a valid candidate immediate, silent confirming feedback. Only accepted authority transitions produce gameplay sounds. Pending reports and rejected inputs remain silent. Initial attachment establishes a silent baseline; unseen retained v2 presentation events play once, with the older accepted-action hint as a compatibility fallback. The app owns audio across presenter/results, so the victory clip may finish; exit, restart and app unmount stop it. Music and clue media still stop when their presenter leaves. Audio receipts report actual ended/failed/stopped outcomes without delaying results or changing clip durations.

### Jeopardy family flow

New Jeopardy sessions persist `setup.jeopardy_flow_version: 2`; sessions created without that field retain their original replay semantics. A host may explicitly enable the new experience only before play or at the untouched second-round introduction after all first-round clues were used. Upgrading preserves scores and used clues.

The Ready screen guides each team through assignment and a fresh second press to test. Successful tests are acknowledged by the session authority. Pressing an already-tested buzzer has no extra sound or setup effect. Disconnected, expired and untested buzzers block Start. The TV mirrors accepted role changes without resetting roles on unchanged presence snapshots.

After judgment, the answer stays visible until the host chooses Next question. A wrong ordinary hosted answer can reopen attempts only while the answer is hidden; revealing ends attempts. An active answerer must still be judged before advancing. A late timeout cannot erase that answerer. After the last first-round answer review, the host chooses Continue to Round 2 or Finish game; Finish keeps current scores and skips remaining rounds and Final.

Daily Doubles belong exclusively to the selecting team. The team chooses an amount before the clue appears; the host sees the allowed range and the actual penalty policy. New Jeremiah and Isaiah rounds explicitly set `daily_double_penalize_wrong: true`: correct adds the wager and wrong deducts it, even when ordinary wrong answers lose zero. Scores can go below zero. The phone previews the actual gain/loss for the selected amount. An absent DD flag retains historical inheritance from `penalize_wrong`; old pinned games keep their original scores and events. Final always adds or deducts its wager.

Presentation cues follow accepted v2 transitions, retained in a bounded sequence of 32 safe events. Initial attachment is silent for historical stings; live snapshots deliver unseen retained cues once. Repeated setup presses, rejected commands and presence updates are silent. Structured buzzer-report and audio lifecycle diagnostics identify the session, team, window/command and accepted revision when available; they do not contain question answers or controller credentials. A playback-start record confirms browser playback acceptance, not physical speaker audibility.


### Ready presence and storage recovery

Ready renews its server lease every 5000ms only after the shared controller poller has observed the assigned hardware within 1000ms. The server lease remains 15000ms. Missing pads generate generation-checked disconnect facts and require retest; stale hardware shows a reconnect cue. Board, clue, judgment, review, wager, round decision and Final send no periodic presence commands. Pending disconnect facts can still retry during play, and no renewal can overwrite an unacknowledged safety report.

The shared gaming coordinator verifies the creation checksum, every committed command/event and the pinned definition on cold recovery, yielding every 32 commands. Matching journal/checkpoint storage versions allow warm requests to use a bounded cache of verified state. Authorization still runs on every request. JSON checkpoints are atomic and retain all accepted-command receipts; an existing YAML checkpoint is read when JSON is absent and remains untouched on promotion. A failed checkpoint after a durable journal commit recovers through exact-envelope retry without duplicate scoring. Unknown changes or corruption invalidate the warm path and fail closed or recover through verified history.

### Investigating buzzer and sound reports

Query VictoriaLogs first (`/select/logsql/query`). For example, use `_time:24h _msg:~"jeopardy.buzzer|party-games.buzz|gaming.input"`, then filter `context.sessionId` or `data.sessionId` to the game. `jeopardy.buzzer.ready-state` reports blockers, fresh hardware facts, epoch, generation, slot and lease age. Pair `report-sent` with `report-result`, `report-unconfirmed`, `report-superseded` or `buzzer-report-failed` by command ID. Controller discovery/disconnection is reported separately by `gamepad.connected`, `gamepad.presence-changed` and `gamepad.disconnected`.

For gameplay latency, query `_time:24h _msg:~"jeopardy.command|gaming.session.operation|jeopardy.cue-result|system.event-loop.lag"`. Operation metrics contain cache outcome, replayed command count and load/replay/append/checkpoint/project/total milliseconds. Input and arbiter suppression use sampled/aggregated reason counters; they do not emit one record per poll. Cue records distinguish browser playback acceptance from ended, failed, stopped or muted playback. Join session/revision with the command result; use only monotonic spans from the same process/page when measuring latency. Neither a play-start nor an ended event proves physical speaker audibility. Logs exclude answers, host tokens and QR payloads.


### Durable release gates

Run both `jeopardy-reliable-input.runtime.test.mjs` and `jeopardy-durable-latency.runtime.test.mjs` against the verified isolated durable harness. The synthetic legacy305 fixture is frozen from commit `7ea3bb308a`; the 1000-command fixture uses legal generic counter commands. Gates assert zero warm journal replay/reads, HTTP p95 ≤50 ms for reads and ≤150 ms for writes, and same-page physical-input-to-TV/audio-start ≤250 ms. The loaded-history game compares early and late questions; the pending-input case requires silent confirmation within 50 ms. Cold recovery is measured separately. Repeat with the deployment image's Node runtime and temporary storage before release. Screenshots, runtime versions, full audio-ended events and raw metrics are release evidence; virtual controllers and browser playback do not certify the room's Bluetooth links or speakers.

Compare reviewed and installed authored content with `node scripts/audit-jeopardy-content.mjs reviewed.yml installed.yml`. The read-only auditor exits 1 on a normalized mismatch,2 on invalid input, and prints paths/hashes rather than answers. A passing source fixture is insufficient: compare actual mounted content and compiled definition identities as well. New Jeremiah and Isaiah packs require31 nonblank references, open-book mode, hosted rounds and explicit risked DD policy. Publishing source content applies to new/restarted games; existing pinned journals and scores remain unchanged.

Ready renewals recheck the current phase, setup epoch, tested assignments and fresh hardware when dequeued and before retrying an explicitly uncommitted conflict. An ambiguous acknowledgment still reconciles with the identical command envelope. TV snapshot notifications share one fetch with a pending follow-up; an older failed read cannot hide a newer accepted command or another session. Suppressed renewals and superseded reads use bounded structured diagnostics.
