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
lifecycle exactly and pushes observations over HTTP.

Both produce the same three events and are consumed identically. The only
difference visible downstream is **confidence**: an inferred observation is
accurate to the polling interval and says so; a self-reported one is exact.

## What is published

Sessions are announced on `play-session:<deviceId>` as `play.session.started`,
`play.session.progress` and `play.session.ended`.

Each message carries the session's identity (device, session, status), what is
being played (content id, title, emulated system and its label), who is playing
(user id and display name), how many controllers were live at once, the time
(cumulative played, granted and remaining where a grant exists, and the accuracy
bound), and where the countdown may be drawn on this system's bezel. The same
fields ride on warnings, so a warning is not a second, thinner kind of message a
surface has to special-case.

Played time is always the **cumulative total** for the session, never an
increment. A duplicated, retried or replayed message therefore cannot double
count, and a dropped one costs nothing because the next carries the truth.

The same sessions are also projected into `device-state:<deviceId>`, so a device
playing a game appears in the media device view exactly as a device playing a
video does. A game is content on a device; it needs no separate view.

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
raises an alarm when a device goes stale, ticks are failing, or the meter can no
longer distinguish playing from paused, and alarms fire on transitions rather
than repeating every interval.

Afterwards, the device's own session logs are compared against what was
observed. Those logs give an exact start time and name the content that was
loaded — but they do **not** give an end: across the living-room device's
history, the median session stops writing 28 seconds in, and most stop within a
minute. So a session the meter missed is reported as a gap with a known
beginning and an unknown duration. Unseen time is surfaced, never invented.

## Attribution

A session belongs to one person, or to an adult. Shared play — several children
on the couch — is attributed to an admin, who has unlimited time; that removes
any need to work out who is holding a controller.

Identity is confirmed at the household fingerprint reader. Because the reader is
in a different room from the screen, authorisation and play are separated in
space and time, so an authorisation names what it permits, expires if unredeemed,
and is recorded on the session it opens. A walk to the reader is not a blank
cheque.

Controllers are counted as evidence, and connection is not use: a pad paired but
idle is not a player. Counting them requires looking for an analog stick — the
television's own remote reports itself as a gamepad, and the air-mouse reports a
joystick.

## Budget and ending

The gaming side never sees currency. It asks for a **grant** — "this session may
play this long, for this person" — burns it, and reports what was played.
Coins, tokens, exchange rates and expiry all live in the economy, so pricing can
change without touching the arithmetic that bills a child. A grant with no
ceiling is an unlimited session.

Whether play may begin at all is a policy question answered by the state gates:
time of day, schoolwork finished, which title, which child, how many controllers
are live — with affordability as one input among those, not the gate itself.

When time runs out the player is **warned before anything is taken away**, at
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
television.
