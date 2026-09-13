# Play Sessions — metered arcade time

How the house knows a game is being played, for how long, by whom, and what
happens when purchased time runs out.

---

## What a play session is

A **play session** is a period during which someone is actually playing a game on
a device. It is not the period a game was open, and it is not the time between
launching and quitting. It is the time the surface was observed *playing*.

That distinction is the whole point. A game paused, backgrounded, or sitting on a
title screen is not play, and billing it would charge a child for a game they
were not playing.

## The two surfaces

Games run on two unrelated surfaces, and the house treats them identically.

The **console emulator** on the living-room screen is a third-party application
that cannot be instrumented. It exposes no remote-control interface at all, so
play is *inferred* from outside: the kiosk reports which application is in front,
and the process's CPU consumption says whether it is emulating or merely open.
Both signals are needed — a misconfigured core leaves the emulator foregrounded,
alive, and burning no CPU with no game loaded, and the foreground signal alone
calls that play.

The **in-browser emulator** in the fitness app is ours, so it reports its own
lifecycle exactly and pushes observations over HTTP. It heartbeats while both
playing and paused: playing samples advance the meter, while paused samples
prove the loaded session still exists without adding time.

Both produce the same three events and are consumed identically. The only
difference visible downstream is **confidence**: an inferred observation is
accurate to the polling interval and says so; a self-reported one is exact.

Game identity and load state are separate facts. Every observation carries
`loaded: true | false | null`: a confirmed load may open a session even before
the title is known, while an unknown title never means that the game ended.
Each load also carries a stable `loadId` (the device log filename or browser
launch key), so switching two unidentified games still produces a real end and
start. The load time is retained separately from `startedAt`; billing begins
only with the first confirmed playing observation.

## What is published

Sessions are announced on both `play-session:<deviceId>` and the house-wide
`play-sessions` topic as `play.session.started`, `play.session.progress` and
`play.session.ended`. Both topics replay the current open session(s) when a
client subscribes, so a page mounting during a pause does not wait for another
heartbeat to learn what is open.

Each message carries the session's identity (device, session, status), what is
being played (content id, title, emulated system and its label), who is playing
(user id and display name), how many compatible controllers were connected,
cumulative played time and its accuracy bound, and where the countdown may be
drawn on this system's bezel. When enforcement emits a warning, that progress
message also carries granted/remaining time and warning copy.

Played time is always the **cumulative total** for the session, never an
increment. A duplicated, retried or replayed message therefore cannot double
count, and a dropped one costs nothing because the next carries the truth.

The same sessions are also projected into `device-state:<deviceId>`, so a device
playing a game appears in the media device view exactly as a device playing a
video does. That projection is the authoritative writer until the play session
ends; generic kiosk heartbeats are suppressed during that window so they cannot
make an active game flicker to idle. A game is content on a device; it needs no
separate view.

Catalog identities use one surface-independent namespace:
`arcade:<system>/<game-id>`. A title therefore rolls up once whether it was
played in the browser or on the living-room console.

## How played time is counted

Time accrues only across consecutive observations that both saw play. Pauses,
backgrounding, idle title screens and the gap across a relaunch contribute
nothing, because they never form such a pair.

Two rules protect the count:

- **A launch is an intent; playing is an observation.** A session becomes
  billable only when play is confirmed, so a launch that never produces a game
  never charges anyone.
- **A silent observer cannot bill the silence.** An interval longer than the
  trusted window is credited only up to that window; the rest is recorded as a
  blind spot rather than quietly becoming time played.

## When the house cannot see

`unknown` is a first-class state. When a device cannot be reached, the meter
neither accrues time nor ends a session nor stops anything — "I could not tell"
is neither "playing" nor "stopped".

That is safe only because blindness is actively fought rather than tolerated.
Observation degrades through alternate channels before giving up, a watchdog
raises an alarm when a device goes stale, ticks are failing, the meter can no
longer distinguish playing from paused, or confirmed play fails to produce a
durable session for two consecutive observations. Alarms fire on transitions
rather than repeating every interval.

Fully Kiosk's `foregroundApp` is the primary presence signal. If that REST call
fails, the observer reads Android's focused activity over ADB and continues with
the same process/CPU confirmation. Only when neither presence channel can answer
does it publish `unknown` from channel `none`.

An open session also has its own house-wide liveness owner. If any surface stops
reporting beyond the configured tolerance (60 seconds at the normal ten-second
poll), the durable record is settled as `lost` with only witnessed time and the
normal `play.session.ended` event is emitted. This covers browser tabs and other
push reporters as well as configured console pollers. At startup, reconciliation
discovers every persisted device id, so a browser-only session cannot survive a
backend restart indefinitely merely because it is absent from the ADB polling
configuration. Override the tolerance with
`games.yml → play_sessions.stale_after_ms` when a surface has a deliberately
slower heartbeat.

Afterwards, the device's own session logs are compared against what was
observed. Those logs give an exact start time and name the content that was
loaded — but they do **not** give an end: across the living-room device's
history, the median session stops writing 28 seconds in, and most stop within a
minute. So a session the meter missed is reported as a gap with a known
beginning and an unknown duration. The device log filename is persisted as
reconciliation evidence, so the same missed session alarms once rather than on
every backend restart. Unseen time is surfaced, never invented.

## Attribution

A session belongs to one person, or to an adult. Shared play — several children
on the couch — is attributed to an admin, who has unlimited time; that removes
any need to work out who is holding a controller.

Identity is confirmed at the household fingerprint reader. Because the reader is
in a different room from the screen, authorisation and play are separated in
space and time, so an authorisation names what it permits, expires if unredeemed,
and is recorded on the session it opens. A walk to the reader is not a blank
cheque.

Controllers are counted as supporting evidence, not as proof of participation:
a pad paired but idle is not a player. On Android, counting requires looking for
an analog stick — the television's own remote reports itself as a gamepad, and
the air-mouse reports a joystick.

The Shield's AudioBridge companion is deliberately not a gameplay signal. Its
current port is a single-client microphone PCM stream: opening it starts audio
capture and occupies the client slot, and its protocol exposes no application,
content, controller or heartbeat state. Treating “AudioBridge process exists” as
“a game is playing” would recreate the same foreground-only false positive this
meter was built to avoid. A future companion telemetry endpoint can be an
additional independent rung, but it must be separate from the audio socket and
must report evidence rather than mere APK liveness.

## Budget and ending

The gaming side never sees currency. It asks for a **grant** — "this session may
play this long, for this person" — burns it, and reports what was played.
Coins, tokens, exchange rates and expiry all live in the economy, so pricing can
change without touching the arithmetic that bills a child. A grant with no
ceiling is an unlimited session.

Whether play may begin at all is a policy question answered by the state gates:
time of day, schoolwork finished, which title, which child, how many controllers
are live — with affordability as one input among those, not the gate itself.

Enforcement is explicitly configured at `games.yml → play_sessions.mode`.
The default is `observe-only`: sessions, history, event traffic and clocks all
run, but nothing warns or stops a game. Set the mode to `enabled` only when the
grant policy and termination behavior have been intentionally commissioned.

When enforcement is enabled and time runs out, the player is **warned before
anything is taken away**, at
five minutes, one minute and twenty seconds, on screen and out loud together.
This is a requirement, not a courtesy: stopping an emulator from outside cannot
make it save first, so ending a session destroys unsaved progress. After a blind
spot that crossed several rungs at once, the most urgent one is announced — the
useful thing to say is the one still true.

At zero the game is stopped and the screen returns to its kiosk. A stop that
fails does not settle the session, because the game is still running and
recording it as finished would stop the meter while a child keeps playing.

## The countdown overlay

A device shows a countdown only if its configuration declares one. The overlay is
durable device state that renders over everything that screen shows, not only
over games, so nothing infers it from "has a screen" or "can launch a game".

It is armed when play is confirmed and torn down when the session ends, rather
than left mounted and blank — it is a live view holding an open connection and
compositing over every frame. Arming on confirmed play also means a launch that
never produces a game puts nothing on screen.

It cannot take focus or absorb input, so it sits over a running game without
pausing it. It renders nothing when it has nothing to say, and if it loses
contact it visibly degrades instead of continuing to tick: a frozen clock that
still looks authoritative would tell a child they have time they may not.

Startup clears any overlay on a device with no open session, so a process that
died mid-session cannot leave a countdown on the family television.

The browser emulator subscribes to its own `play-session:<deviceId>` feed and
draws the same server-authoritative clock directly in its React tree. It never
uses the Android device overlay. Paused messages freeze that clock, and a stale
feed is labelled offline rather than continuing to extrapolate.

## Live inspection

The HTTP surface is available under `/api/v1/play-sessions`:

| Endpoint | Answer |
|---|---|
| `GET /open` | Every currently open session in the house |
| `GET /devices/:deviceId` | The open session on one device, or `null` |
| `GET /devices/:deviceId/history?since=<ISO>` | Durable history for one device |
| `GET /usage?since=<ISO>&until=<ISO>` | Played-time rollups across devices |
| `GET /health` | Tracker state, failures, degraded/unrecordable status, blocked devices, and open-session monitor health |
| `GET /placement[?system=<id>]` | Validated countdown geometry |

For live consumers, subscribe to `play-sessions` for the house or
`play-session:<deviceId>` for one surface. Every progress message is
self-contained; consumers do not need to retain the start event to interpret
the latest state.

## Where the countdown is allowed to draw

An emulated console does not fill the television. It is framed by bezel artwork —
a Game Boy shell, a Super Famicom fascia — with the game showing through a hole
in the middle, and that hole is a different size and in a different place on
every system. "Put the timer in the bottom third" is therefore not a placement:
on a Game Boy the bottom third is moulded plastic, and on an NES it is the game.

So placement is stated per emulated system, and the source is the bezel art
itself. For each system the configuration records the **game screen** — the hole
the art leaves — and an ordered list of **zones**: bands of surrounding chrome,
each carrying the largest patch of genuine negative space inside it. Negative
space means flat art: an empty moulded face, a painted panel, the black beyond a
letterbox. A logo, a button, a grille or a label all disqualify a patch, so the
countdown sinks into the design rather than sitting on top of it.

Every rectangle is `[x, y, w, h]` normalised to 0..1 of the output, so it means
the same thing at any resolution and to a screenshot as to the overlay.

The invariant that carries the value: **a zone never intersects the game
screen**. That is checked when configuration loads, not trusted, and a system
whose geometry has drifted is named and dropped rather than used — losing a
countdown's position must never cost the meter, and a countdown on top of the
game is worse than none.

The emulated system comes from the launcher catalog, never from the emulator
core: one core serves both Game Boy and Game Boy Color, and those have different
bezels. A session started by hand at the device opens without a title, so the
device's own logs are read while it is still running to fill the blank in — which
is what lets a hand-started game be placed at all, instead of waiting for the
next restart.

The surface is told where it may draw rather than knowing it. Given a zone it
fits its contents to the rect, and where the zone is too small to hold everything
legibly it sheds detail — supporting fields first, then the progress bar, then
the portrait — rather than clipping or shrinking type into illegibility. The
clock and the player's name always survive.

`GET /api/v1/play-sessions/placement` returns the whole table, `?system=` one of
them, so what the surface was told can be checked without reading the
