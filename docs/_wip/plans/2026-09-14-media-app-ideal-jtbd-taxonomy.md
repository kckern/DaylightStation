# Media App: Ideal Jobs-to-be-Done Taxonomy

**Date:** 2026-09-14
**Status:** Proposal. A model of the jobs the app should serve. No screens designed yet. The owner's decisions on the open questions are recorded in §5 and applied throughout.
**Evidence:** the media app jobs-to-be-done baseline audit of 2026-09-14. Audit job IDs (A1…K3) appear in parentheses as evidence only.

---

## How to read this

This document describes what people in the household are trying to get done with their media. It does not describe screens. It is the base a separation-of-concerns redesign can be checked against: every screen that gets designed later should be able to say which jobs it serves, and no job should end up owned by two places.

- **Personas** are *modes of intent*, not kinds of people. The same parent is a Seeker at 7 pm, a Caster at 7:01, and a Fixer at 7:15 when the TV won't start.
- **The taxonomy** runs *Domain → Job group → Job*. Each job has a stable ID such as `PLACE.3`. Each job group has an ID such as `PLACE-A`.
- **User stories** sit under their job groups. Story IDs add a letter to the job ID (`PLACE.3a`). Acceptance criteria describe what a person sees, hears, or can do.
- **Mappings** tie it together: which personas care about which groups, the path each persona takes, how the ideal jobs cover the audit's jobs, and where personas pull against each other.

Words used throughout:

| Word | Meaning in this document |
|---|---|
| **Screen** | Anything that can play: a TV, a speaker, a tablet on the wall, or the phone or laptop in your hand. The device in hand is one screen among many. |
| **This device** | The phone, tablet, or laptop the person is holding right now. |
| **Aim** | Where new things will play if the person just says "play". |
| **Lineup** | What is playing on a screen plus what is coming up next on that screen. |
| **Steer** | Control something that is already playing (pause, skip, volume, reorder the lineup). |
| **Send** | Start content on, or move playback to, a screen other than this device. |

**Words on screen (decided, Q9):** this document keeps its working terms, but the product says **Play on…** for *send*, **Queue** for *lineup*, and **Remote** for *steering another screen*.

---

## 1. Personas

Ten modes of intent. The eight the owner named, sharpened, plus two the evidence supports: the **Resumer** (picks something back up; audiobooks, series, a film stopped halfway) and the **Fixer** (something has gone wrong and needs putting right fast).

| # | Persona | In one line |
|---|---|---|
| P1 | **Wanderer** (Browser) | No title in mind; wants to be shown something good. |
| P2 | **Seeker** | Knows exactly what they want; types it and goes. |
| P3 | **Big-Screen Sender** (Caster) | Uses the phone as a remote to get something onto a TV or speaker. |
| P4 | **House Watch** (Device Monitor) | Wants to know what's on around the house and control it from wherever they are. |
| P5 | **Hand-Held Viewer** (In-Browser Watcher/Listener) | Plays on the device in hand, and wants it to stay there. |
| P6 | **Lineup Builder** (Playlist/Queue Curator) | Shapes what plays next and in what order. |
| P7 | **Room Hopper** (Session Mover) | Moves what's playing from one room or screen to another without losing the spot. |
| P8 | **Routine Setter** (Automation Author) | Wants the house to start the right thing on the right screen with nobody touching anything. |
| P9 | **Resumer** | Comes back to something unfinished and wants to be exactly where they left off. |
| P10 | **Fixer** | Something is wrong (wrong screen, nothing started, stuck playing) and they want it fixed now. |

---

### P1. Wanderer (Browser)

- **Identity:** "I've got 40 minutes and no idea what to put on."
- **Situation:** On the couch with a phone or tablet, often with others waiting and chipping in. Low time pressure at first, rising as the room gets restless.

**Larger jobs**
- **WA-1** Find something that suits the moment without knowing its name.
- **WA-2** Check an item is right before committing the room to it.
- **WA-3** Get it playing where everyone is watching.

**Priorities** (ranked)
1. Seeing things. Pictures, kinds, collections, not bare lists of names.
2. Being able to look without accidentally starting anything.
3. A quick, low-risk "try it" once something looks good.
4. Tolerates: a few extra taps while exploring. Does not tolerate: dead ends or losing their place when they back out.

**Primary paths**
- **WA-1:** Opens the app and sees suggestions that fit the time of day and what the household plays → picks a kind (films, music, audiobooks) → scrolls pictures of titles → opens a show or album and sees its parts in order → backs out and finds the same spot in the list.
- **WA-2:** Opens one title → sees its picture, description, length, and whether anyone has already started it → decides.
- **WA-3:** Sees, near the play action, which screen it will play on → plays → sees and hears it start on that screen, or is told clearly that it is still getting ready.

**Frustrations today**
- Browsing is lists of names with no pictures, and the start page no longer offers ways into the catalog (A4).
- Finding out more about one item is hidden behind a path most people won't find (A6).
- Buttons on the same page play in different places, so "try it" might start on the wrong screen (A5, B1, D1).
- Backing out doesn't follow a trail; it goes wherever you were before (K2).

**Success signal:** The room is watching something, and nobody asked "what's this?"

---

### P2. Seeker

- **Identity:** "Put on Bluey."
- **Situation:** Phone in hand, standing up, often mid-task or with a child asking. High time pressure. Wants one attempt to work.

**Larger jobs**
- **SK-1** Get from a name in my head to that exact thing playing, fast.
- **SK-2** Narrow when the name is ambiguous (the song or the album? the film or the soundtrack?).
- **SK-3** Queue it instead of playing it when something is already on.

**Priorities** (ranked)
1. Speed: typing is available from anywhere, immediately.
2. The same search, with the same results and actions, wherever they start from.
3. Certainty that results are complete, or a clear statement of what's missing.
4. Tolerates: a less pretty result list. Does not tolerate: a tap going somewhere unexpected.

**Primary paths**
- **SK-1:** Starts typing from wherever they are → results appear as they type, with a picture and kind for each → sees that all sources have answered → taps the right result → it plays where the app said it would → a brief confirmation names the title and the screen.
- **SK-2:** Picks a kind (music, shows) to narrow → if nothing matches there, sees an offer of matches from everywhere, clearly labelled.
- **SK-3:** On a result, chooses "play next" or "add to the end" → sees a confirmation naming the title and the screen whose lineup it joined.

**Frustrations today**
- Three different searches behave three different ways; one of them sends anything you tap straight to a device (A1, A3, G4).
- The same tap confirms on a phone and stays silent on a laptop (A1).
- The kind chosen to narrow a search is forgotten inconsistently (A2).
- "Play now" from a result's extra actions plays here even when the screen says the TV (B1, D1).

**Success signal:** The thing they typed is playing on the screen they meant, within seconds, first try.

---

### P3. Big-Screen Sender (Caster)

- **Identity:** "My phone is the remote. The TV is where things play."
- **Situation:** In the living room or kitchen, phone in hand, others in the room looking at the TV. Moderate time pressure. Often sends several things in a row.

**Larger jobs**
- **BS-1** Point the phone at a TV or speaker for the evening so every "play" goes there.
- **BS-2** Send one thing somewhere else without changing that.
- **BS-3** Know the TV really started, and fix it quickly if it didn't.
- **BS-4** Point the phone back at itself when done.

**Priorities** (ranked)
1. Knowing, before every tap, which screen it will go to.
2. Proof it started: progress while the TV wakes, a clear "playing now".
3. Not interrupting someone else's viewing by mistake.
4. Tolerates: a few seconds of waiting while a TV turns on. Does not tolerate: silence, or being stuck aimed at a TV.

**Primary paths**
- **BS-1:** Chooses a screen from a list showing each one's room and what it's doing now → the choice stays visible wherever a play action is → plays things and each one goes to that screen.
- **BS-2:** On any item, chooses "play on…" → picks a screen → it goes there, and the evening's aim is unchanged.
- **BS-3:** After sending, sees steps ("turning on", "loading", "playing") → if it fails, sees what failed and retries that exact send → from the confirmation, jumps straight to steering it.
- **BS-4:** Taps the visible aim → chooses "this device" → the aim reads "this device".

**Frustrations today**
- Only some play buttons go where the phone is aimed; others quietly play on the phone (B1, C1, C2, A6, A7, D1).
- On a phone, once a TV is chosen there is no way to aim back at the phone (D2).
- Whether the phone keeps playing after sending can't be seen or changed on a phone (D5).
- Sending one item somewhere without changing the aim exists in only one hidden place (D3).
- Retry on an older failure re-sends a different, newer attempt (E3).
- The shortcut from "it's playing" to steering it vanishes after a few seconds (E4).
- Feedback differs by which button was used: sometimes a message and progress, sometimes progress only (E1).

**Success signal:** The TV is playing the right thing, and the phone's aim says what they expect it to say.

---

### P4. House Watch (Device Monitor)

- **Identity:** "What's on in the kids' room? Why is the kitchen speaker still going?"
- **Situation:** Anywhere in the house or away from the room in question; often a parent. Usually a quick check, sometimes an urgent "stop that now".

**Larger jobs**
- **HW-1** Glance at whether anything is playing anywhere.
- **HW-2** See exactly what each screen is doing, and trust that it's current.
- **HW-3** Pause, stop, turn down, or change what's on a screen from afar.

**Priorities** (ranked)
1. An honest overview: what's playing, what's paused, what's off, and how fresh that is.
2. One tap from seeing a screen to steering it.
3. Recognisable names for every screen, including other people's phones and laptops.
4. Tolerates: coarse detail at a glance. Does not tolerate: stale information shown as live, or anonymous screens.

**Primary paths**
- **HW-1:** From wherever they are in the app, sees a single house indicator: how many screens are playing → opens it.
- **HW-2:** Sees every screen by name and room: what's on, progress, paused or off, and a clear mark when a screen hasn't reported recently → sees whether a person or a routine started it.
- **HW-3:** Taps a screen → gets the same controls they use for their own playback → pauses or turns it down → the screen's status changes to confirm.

**Frustrations today**
- The house indicator is missing on phones and doubled on larger screens (F1).
- Remote controls for a screen differ from controls for this device, with fewer options (G1, G2).
- Browsers show up as meaningless codes instead of names (J3).
- Controlling a screen silently changes where search results go (D1, G4).

**Success signal:** They know what's playing everywhere, and the one screen they cared about is now doing what they wanted.

---

### P5. Hand-Held Viewer (In-Browser Watcher/Listener)

- **Identity:** "I'm watching this on my laptop. Leave the TV out of it."
- **Situation:** Alone: in bed with a tablet, at a desk with a laptop, in the kitchen with a phone playing an audiobook. Long stretches of watching or listening. Often switches to other parts of the app while playing continues.

**Larger jobs**
- **HH-1** Play something on the device in hand.
- **HH-2** Keep control of it while doing other things in the app.
- **HH-3** Watch video big, and steer it precisely (scrub, speed, volume).

**Priorities** (ranked)
1. Taps stay on this device unless they deliberately choose otherwise.
2. A persistent handle on what's playing, from everywhere in the app.
3. Precise controls: jump back a few seconds, change speed.
4. Tolerates: a small player while browsing. Does not tolerate: playback jumping to the TV, or losing their place when the page reloads.

**Primary paths**
- **HH-1:** Confirms the aim reads "this device" → plays → it starts here.
- **HH-2:** Keeps browsing → a compact handle shows title, progress, play/pause → taps it to open full controls and the lineup.
- **HH-3:** Expands video to fill the screen → scrubs, jumps back 10 seconds, changes speed and volume → shrinks back to browsing without interrupting.

**Frustrations today**
- Two sets of identical buttons on the same screen (B4, C6).
- A mysterious aim at the TV that can't be undone on a phone sends their taps away (D2).
- Stopping hides the lineup with no way back to it (B7, K3).
- A "resume" offer keeps appearing for the thing already playing (B2).
- Nothing tells them when playback fails and skips on (I4).

**Success signal:** It is playing in their hands, and every control they reach for is where they expect it.

---

### P6. Lineup Builder (Playlist/Queue Curator)

- **Identity:** "Dinner music for the next two hours, in this order, then the kids' songs."
- **Situation:** Laptop or tablet, often before an event or while cooking. Low time pressure while building; wants the result to run unattended.

**Larger jobs**
- **LB-1** Build a lineup from many searches and collections without interrupting what's playing.
- **LB-2** Arrange it: reorder, remove, jump, repeat, shuffle.
- **LB-3** Build or edit the lineup of a screen other than the one in hand.

**Priorities** (ranked)
1. Every addition is confirmed and lands where they intended.
2. The lineup is always reachable, including after something stops.
3. Clear, distinct verbs: "play next" vs "add to the end", one meaning each.
4. Tolerates: dense controls. Does not tolerate: a lineup wiped by one tap with no way back.

**Primary paths**
- **LB-1:** Searches or browses → on each item or whole collection, chooses "add to the end" or "play next" → sees a confirmation naming the screen and position → the lineup count visibly grows.
- **LB-2:** Opens the lineup from anywhere → drags or moves items, removes one, sets repeat → clears it, and can undo if that was a mistake.
- **LB-3:** Chooses which screen's lineup they are working on → every addition says it is joining that screen's lineup → watches the lineup update.

**Frustrations today**
- Additions give no confirmation (C2).
- "Play next" and "Up next" both exist with no explanation (C1).
- The lineup is reachable only through the small player, and becomes unreachable after stopping (C5, K3, B7).
- Shuffle and repeat appear twice on one screen (C6).
- A single item can't be added to another screen's lineup at all (G5).
- Clearing the lineup happens instantly with no undo (C5).

**Success signal:** The lineup reads exactly as intended, on the intended screen, and plays through unattended.

---

### P7. Room Hopper (Session Mover)

- **Identity:** "I was watching in the living room; I'm going to bed. Carry on in there."
- **Situation:** Mid-film or mid-audiobook, walking between rooms, phone in hand. Wants no fiddling and no rewinding.

**Larger jobs**
- **RH-1** Move what's playing on a TV to the device in hand, at the same moment.
- **RH-2** Move what's playing on the device in hand to a TV or speaker, at the same moment.
- **RH-3** Move playback between two other screens from the phone.

**Priorities** (ranked)
1. Exact continuity: same item, same spot, same lineup.
2. The original screen stops (unless they choose otherwise).
3. Available from wherever they see the playback: the house overview, the screen's controls, their own player.
4. Tolerates: a short pause during the move. Does not tolerate: starting over, or two screens playing by accident.

**Primary paths**
- **RH-1:** Sees the TV's playback (in the house overview or its controls) → chooses "move to this device" → the TV stops, this device picks up at the same moment → a confirmation says so.
- **RH-2:** From their own player, chooses "move to…" → picks the bedroom screen, seeing what it's doing now → sees progress, then "playing in the bedroom" → this device stops (or keeps playing, if they chose that).
- **RH-3:** From the living room TV's controls, chooses "move to…" → picks the kitchen speaker → sees both screens update.

**Frustrations today**
- Pulling playback here exists only on one card in the device list, not in the device's own controls, and success says nothing (H1).
- Pushing playback to a TV is hidden below the lineup on one screen only (H2).
- Moving between two other screens isn't possible at all (no audit counterpart).
- Whether this device stops after sending can't be seen on a phone (D5).

**Success signal:** They sit down in the new room and it's already playing from the right second.

---

### P8. Routine Setter (Automation Author)

- **Identity:** "Pressing the kitchen button should start the morning programme on the living room TV."
- **Situation:** Sets things up once, rarely, often on a laptop. The *outcome* is experienced later by everyone else, who never touches the app.

**Larger jobs**
- **RS-1** Have a button, tag, or routine start specific content, a lineup, or a shuffled collection on a specific screen.
- **RS-2** Have that start behave exactly like a person starting it: visible in the house overview, steerable, confirmable.
- **RS-3** Have every screen reliably known by a stable, human name so routines can target it.

**Priorities** (ranked)
1. Predictability: the same trigger always produces the same result.
2. Repeating a trigger does not pile up duplicate starts.
3. People in the room can override a routine with normal controls.
4. Tolerates: set-up effort. Does not tolerate: silent failure, or a screen whose name changes.

**Primary paths** (as outcomes, from the household's side)
- **RS-1:** Someone presses the button → the named screen starts the chosen content with the chosen options (shuffle, volume, order) → nobody opens the app.
- **RS-2:** Anyone glancing at the house overview sees that screen playing, marked as started by a routine → they can pause or change it like anything else.
- **RS-3:** Every screen, including a browser left open on a wall tablet, appears under a name chosen for it and keeps that name.

**Frustrations today**
- Routine starts are invisible to people: nothing shows that a routine started it (J1).
- Browsers can't be given names, so they can't be told apart or targeted sensibly (J3).
- Other house displays only learn what a browser plays if that browser tells them, with no user-visible sign that it does (J2).

**Success signal:** The button does the same right thing every morning, and nobody has had to explain why the TV came on.

---

### P9. Resumer

- **Identity:** "Where was I in that audiobook? Next episode, please."
- **Situation:** Any device, any room. Comes back hours or days later. Often a series, an audiobook, or a film abandoned halfway.

**Larger jobs**
- **RE-1** Find the unfinished thing without searching.
- **RE-2** Continue from exactly where it stopped, or deliberately start over, on whichever screen is at hand.
- **RE-3** Go on to the next episode or chapter.

**Priorities** (ranked)
1. Exact position, even if it was last played on a different screen.
2. Unfinished things put in front of them, not hidden among everything played.
3. A clear choice between "continue" and "start over".
4. Tolerates: a list of several unfinished things. Does not tolerate: offers to resume something already playing, or a history that forgets what played on the TV.

**Primary paths**
- **RE-1:** Opens the app → sees "carry on" items with picture, where they stopped, and which screen they last played on.
- **RE-2:** Taps one → chooses continue or start over → it plays at the current aim from the right spot.
- **RE-3:** Nearing the end, sees what comes next in the series → it continues, or they choose it.

**Frustrations today**
- Recently played only covers what played on this device; anything sent to a TV never appears (A7).
- A recent item has only one action, which replaces the lineup and plays here regardless of aim (A7).
- "Resume" is offered for things already playing (B2).

**Success signal:** It picks up mid-sentence, on the screen they're in front of.

---

### P10. Fixer

- **Identity:** "The TV didn't start. Why is my phone playing it? Just make it stop."
- **Situation:** Any device, usually mid-evening, with someone waiting or annoyed. Highest time pressure of any persona. Not interested in why; wants it right.

**Larger jobs**
- **FX-1** Find out what went wrong with something they just tried.
- **FX-2** Retry or redirect that exact attempt.
- **FX-3** Stop what's playing anywhere, or undo the thing they just did.
- **FX-4** Get back to a known, clean starting point.

**Priorities** (ranked)
1. Plain-language explanation of the failure, next to the thing that failed.
2. A one-tap fix: retry this, send it somewhere else, stop it, undo it.
3. Knowing what a "stop" or "start fresh" will leave behind.
4. Tolerates: an extra confirmation for something truly destructive. Does not tolerate: hidden failures, or a fix that does something different from its label.

**Primary paths**
- **FX-1:** Sees a failure message wherever they are in the app, naming the item and the screen → opens it to see the step that failed.
- **FX-2:** Taps retry on that failure → that exact attempt is retried → or chooses "play somewhere else" and picks another screen.
- **FX-3:** Opens the house overview or their own player → stops the playback → sees what remains (the lineup kept, ready to reopen) → or undoes the last clear or replace.
- **FX-4:** Chooses "start fresh" → is told exactly what will be cleared (lineup, position, aim) → confirms → everything reads as new.

**Frustrations today**
- Retry re-sends a different attempt than the one it sits beside (E3).
- Playback failures are shown in one place only and skip on silently (I4).
- A phone can get stuck aimed at a TV, and starting fresh doesn't fix it (D2, I2).
- Stop removes the only way back to the lineup (B7, K3).
- Several stop and clear controls do different things, some with confirmation, some without (B7, C5, I2).

**Success signal:** The right thing is playing (or nothing is), and they understand why.

---
## 2. Ideal taxonomy

### 2.1 The top-level cut

Every moment of using a household media app answers one of a few separate questions. The audit shows that today the answers are tangled: "where will this play" is decided separately inside each button (A5, B1, C1, D1), "what is playing" is controlled by different buttons depending on which screen it's on (B4, G1, G2), and "did that work" depends on which control was used rather than on what happened. The cut below gives each question exactly one home.

| Domain | The question it answers | Owns | Explicitly does NOT own |
|---|---|---|---|
| **FIND** — Find something | *What is there, and which one do I want?* | Searching, narrowing, exploring, learning about an item, getting back to things played before | Starting anything; where things play. Finding never changes what is playing. |
| **PLAY** — Decide what plays | *What should happen with this item?* | The content verbs: play now, play a whole collection, shuffle it, continue or start over, play next, add to the end | Where it plays (that is PLACE); changing a lineup that already exists (that is STEER). A PLAY verb means the same thing on every item, everywhere it appears. |
| **PLACE** — Choose where it plays | *Which screen, or screens?* | The aim, knowing it before acting, one-off sends, several screens at once, keep-or-move, moving existing playback between screens | What content is chosen; controlling it once it's there. |
| **STEER** — Steer what's playing | *How do I control what's already on?* | Knowing which playback I'm steering, transport, position, volume and speed, stopping, the lineup of that playback, watching big | Starting new content; the house-wide picture. One set of controls serves this device and every other screen alike. |
| **HOUSE** — See the house | *What's happening on every screen?* | The glance, each screen's detail, freshness, screen names, who or what started something | Controlling a screen (the path hands off to STEER); choosing a screen for new content (PLACE). |
| **RELY** — Rely on it | *Did it work, what went wrong, and where am I?* | Confirmation of every action, progress on far screens, failure notices, retry and undo, keeping my place through reloads and hiccups, starting fresh, orientation and going back | Doing the actions themselves. RELY is the single voice that reports outcomes, so every action reports the same way. |
| **AUTO** — Let the house start things | *How does playback happen with nobody at a screen?* | Outcomes of buttons, tags and routines starting playback; the house knowing what each screen plays | How routines are built. Once started, automated playback is steered, seen and confirmed through STEER, HOUSE and RELY like any other. |

**Where the audit's scattered concerns now live**

| Scattered today | Clean home | What that means for a person |
|---|---|---|
| "Where does it play" decided inside every button (A5, B1, C1, C2, D1, A6, A7) | **PLACE** alone | Every PLAY verb obeys one visible aim. A one-off exception is a separate, explicit choice (`PLACE.3`). |
| Controlling "this device" vs "another screen" as different interactions (B4, B5, G1, G2) | **STEER**, for whichever playback is chosen | One set of controls, pointed at whichever playback you've chosen (`STEER.1`). |
| Being in a screen's controls silently changing where search results go (D1, G4) | Split: **STEER** knows what you're steering; **PLACE** knows where new things go | The two are never linked without saying so on screen (Tension T2). |
| Putting something on a device via four separate routes (G4) | **FIND** + **PLAY** + **PLACE** | There is no separate "play on a device" job. It is the normal find, the normal verb, and a screen choice. |
| Confirmation depending on which control was used (E1, E3, I4) | **RELY** | The same kind of outcome always reports the same way. |
| The lineup reachable only through the small player (C5, K3, B7) | **STEER** lineup group | The lineup is a first-class thing a person can always reach, including after stopping. |
| Three searches (A1, A3, G4) | **FIND** search group | One search. What you do with a result is PLAY and PLACE, not a different search. |

### 2.2 Domains, groups, jobs

Jobs are stated as the person would say them. The motivation follows the dash.

#### FIND — Find something

| Group | ID | Job |
|---|---|---|
| **FIND-S** Look for something I can name | FIND.1 | Find a title by typing its name, from anywhere in the app — so I get to it in seconds. |
| | FIND.2 | Narrow a search to a kind of content (music, shows, audiobooks, photos, channels, cameras) — so a common name doesn't drown the thing I mean. |
| | FIND.3 | Know whether results are still arriving, complete, or missing a source — so I can trust that "not found" means not there. |
| | FIND.4 | Get a sensible next step when nothing matches — so a dead end becomes a near miss. |
| **FIND-E** Explore without a title | FIND.5 | Wander the catalog by kind, with pictures — so I can recognise what I want when I see it. |
| | FIND.6 | Look inside a show, season, album, playlist, or folder and see its parts in order — so I can pick the right episode or track. |
| | FIND.7 | Be offered things that suit this moment and this household — so I have somewhere to start when I have no idea. |
| **FIND-L** Understand before choosing | FIND.8 | Learn about one item (picture, description, length, kind, progress so far) without starting it — so I commit the room to the right thing. |
| **FIND-R** Return to what we've played | FIND.9 | Get back to something played recently on any screen in the house — so I don't have to search for it again. |
| | FIND.10 | See what's unfinished and what comes next in a series — so I can carry on without remembering where I was. |

#### PLAY — Decide what plays

| Group | ID | Job |
|---|---|---|
| **PLAY-S** Start something | PLAY.1 | Play this item now, replacing what's on at the aim — so it starts immediately. |
| | PLAY.2 | Play a whole show, album, or playlist in order — so I don't have to pick each part. |
| | PLAY.3 | Shuffle a whole collection — so it plays in a fresh order. |
| | PLAY.4 | Choose between continuing where it was left off and starting from the beginning — so I don't lose, or am not forced into, an old position. |
| **PLAY-L** Line things up | PLAY.5 | Play this right after the current thing — so it's next without interrupting. |
| | PLAY.6 | Add this to the end of the lineup — so it plays eventually without disturbing the order. |
| | PLAY.7 | Add a whole collection to the lineup, next or at the end — so I can build long lineups quickly. |

#### PLACE — Choose where it plays

| Group | ID | Job |
|---|---|---|
| **PLACE-A** Aim at a screen | PLACE.1 | Know where it will play before I act, wherever I'm about to play from — so a tap never surprises me. |
| | PLACE.2 | Aim at a screen for a while, then back at this device in one step — so the evening's sending is effortless and never gets stuck. |
| | PLACE.3 | Send just this one thing to a different screen without changing my aim — so exceptions don't cost me my set-up. |
| | PLACE.4 | Play on several screens at once — so the whole downstairs hears the same music. |
| | PLACE.5 | Choose a screen while seeing what each is doing and what I'd interrupt — so I don't cut off someone else's programme. |
| | PLACE.6 | Decide whether this device keeps playing when I send elsewhere — so I get either a hand-off or a second room, on purpose. |
| **PLACE-M** Move what's playing | PLACE.7 | Bring what's playing on another screen to this device, at the same moment — so I can carry on as I leave the room. |
| | PLACE.8 | Send what's playing on this device to another screen, at the same moment — so I can move to the big screen without starting over. |
| | PLACE.9 | Move playback between two other screens from where I am — so I can follow someone's programme around the house. |

#### STEER — Steer what's playing

| Group | ID | Job |
|---|---|---|
| **STEER-H** Keep hold of what's playing | STEER.1 | Always see which playback I'm steering, reach it from anywhere, and switch to another screen's — so control is one tap away and never ambiguous. |
| | STEER.2 | Watch video big, and shrink it back without interrupting — so I can watch properly and still use the app. |
| **STEER-T** Control playback | STEER.3 | Pause, resume, skip forward or back — so I can react to the room. |
| | STEER.4 | Move to a position: scrub, jump back or forward a few seconds, go live — so I can catch what I missed. |
| | STEER.5 | Change volume and playback speed — so it suits the room and the listener. |
| | STEER.6 | Stop, knowing what stopping leaves behind — so I end playback without losing the lineup by accident. |
| **STEER-Q** Shape the lineup | STEER.7 | See what's playing and what's coming up, for any playback, even after it stops — so I always know what happens next. |
| | STEER.8 | Reorder, jump to, remove, or clear items in the lineup — so the order is what I want. |
| | STEER.9 | Set repeat and shuffle for the lineup — so it plays on the way I want without me. |

#### HOUSE — See the house

| Group | ID | Job |
|---|---|---|
| **HOUSE-O** Overview | HOUSE.1 | Glance at whether anything is playing anywhere, from wherever I am in the app — so I notice without going looking. |
| | HOUSE.2 | See what each screen is doing: title, progress, playing, paused, or off — so I know what is happening around the house at once. |
| | HOUSE.3 | Tell whether what I'm seeing is current — so I don't act on old news. |
| **HOUSE-K** Know the screens | HOUSE.4 | Recognise every screen, including phones and laptops, by a name people use — so I can tell them apart and pick the right one. |
| | HOUSE.5 | See whether a person or a routine started what's playing — so a TV that "turned itself on" makes sense. |

#### RELY — Rely on it

| Group | ID | Job |
|---|---|---|
| **RELY-C** Know my action worked | RELY.1 | Get the same kind of confirmation for the same kind of outcome, naming the item and the screen — so I never wonder whether a tap did anything. |
| | RELY.2 | See progress while a far screen gets ready (turning on, loading) — so waiting doesn't feel like failure. |
| | RELY.3 | Know that it actually started playing on the far screen, or might not have — so I can stop watching the phone. |
| | RELY.4 | Undo my last change to what's playing or lined up — so a slip costs nothing. |
| **RELY-R** Recover when it goes wrong | RELY.5 | Be told when playback fails or skips an item, wherever I am in the app — so silence never hides a problem. |
| | RELY.6 | Retry exactly the attempt that failed, or redirect it to another screen — so fixing it is one step. |
| **RELY-K** Keep my place | RELY.7 | Keep what's playing, its position, and its lineup through a reload, a crash, or a network hiccup — so nothing is lost when something outside my control happens. |
| | RELY.8 | Start fresh when I choose, knowing exactly what will be cleared — so I can reset without surprises. |
| **RELY-O** Stay oriented | RELY.9 | Know where I am in the app and move between its main areas — so I never feel lost. |
| | RELY.10 | Go back one step predictably — so I can retrace my way out. |

#### AUTO — Let the house start things

| Group | ID | Job |
|---|---|---|
| **AUTO-T** Start from a trigger | AUTO.1 | When a button, tag, or routine fires, start the chosen content (item, lineup, shuffled collection, with volume) on the chosen screen — so the house does the right thing with nobody touching a screen. |
| | AUTO.2 | Have repeated or overlapping triggers produce one predictable result, and let people in the room override it normally — so routines never pile up or fight the household. |
| **AUTO-O** Let the house know | AUTO.3 | Let every other screen and household display know what each screen is playing — so the house picture is complete, including browsers. |

**Totals:** 7 domains, 19 job groups, 53 jobs.

---

## 3. User stories by job group

Story IDs extend the job ID with a letter. Acceptance criteria (AC) are observable outcomes.

### FIND-S — Look for something I can name

**FIND.1a** As a **Seeker**, I want to start typing a title from anywhere in the app, so that I reach it without navigating first.
- From any part of the app, one obvious action (or starting to type, where there is a keyboard) opens search with the cursor ready.
- Results begin appearing while I type, each with a picture, title, and kind.
- The search looks and behaves the same on a phone, tablet, or laptop, and whatever I was doing before (including steering another screen).
- Closing search returns me to exactly where I was.

**FIND.1b** As a **Big-Screen Sender**, I want the search I use for a TV to be the same search I use for this device, so that I don't have to learn a second one.
- There is only one search. Choosing a screen never opens a different search.
- The actions on a result are the same whichever screen is aimed at; only the stated destination differs.

**FIND.2a** As a **Seeker**, I want to narrow my search to a kind of content, so that "Frozen" finds the film and not forty songs.
- Kinds are shown as choices next to the search; the current one is always visible.
- Choosing a kind updates results immediately without retyping.
- Kinds that contain sub-kinds (for example, Music → Hymns) let me choose either level.
- The kind I chose stays while search is open; the next time search opens it starts at All. Same on every device (Q6).

**FIND.3a** As a **Seeker**, I want to know whether the results are complete, so that I can trust a short list.
- While sources are still answering, I see that results are still arriving.
- When all are in, the "still arriving" sign disappears.
- If a source didn't answer, I'm told which, in plain words, with a way to try it again.
- These signs look and read identically wherever search appears.

**FIND.4a** As a **Seeker**, I want a helpful next step when nothing matches, so that I'm not stuck.
- If nothing matches in the chosen kind, I see matches from all kinds, with a clear note saying the search was widened.
- If nothing matches anywhere, I'm told so plainly and offered to check spelling or browse the nearest kind.
- An empty result never looks like a result still loading.

### FIND-E — Explore without a title

**FIND.5a** As a **Wanderer**, I want to explore the catalog by kind with pictures, so that I can recognise something good.
- I can reach every kind of content without typing.
- Every title shows a picture (or a recognisable placeholder), title, and kind.
- Long collections load more as I scroll, without a separate button hunt.
- Backing out returns me to the same scroll position.

**FIND.6a** As a **Wanderer**, I want to open a show, album, or folder and see its parts in order, so that I can choose the right one.
- Parts appear in their natural order (episodes by season, tracks by number).
- I can see where I am as a trail (for example: TV → Bluey → Season 2) and jump to any level.
- The whole-collection actions (play, shuffle, add) are available at the top and name the screen they will use.

**FIND.7a** As a **Wanderer**, I want to be offered things that suit the moment, so that I have a place to start.
- Opening the app shows a small set of suggestions (for example: what's unfinished, what the household plays at this time of day, new additions).
- Suggestions follow the same tap rule as every other item: a collection opens, a playable item plays at the aim, and details are one step away (Q2).
- Suggestions never repeat what's already playing on this device.

### FIND-L — Understand before choosing

**FIND.8a** As a **Wanderer**, I want to see details about one item without starting it, so that I can decide with confidence.
- From any item, wherever it appears (search, browsing, suggestions, recent), I can open its details in one step.
- Details show picture, title, description, length, kind, and how far anyone has got.
- Details offer the same play and line-up actions as everywhere else, with the destination stated.
- Opening details never starts, stops, or changes playback.

**FIND.8b** As a **Seeker**, I want tapping a result to do the obvious thing while details stay one step away, so that speed and understanding don't compete.
- Tapping a playable item (episode, song, film) plays it at the aim; tapping a collection (show, season, album, playlist, artist, folder) opens it. Same everywhere (Q2).
- A mis-tap costs nothing: the confirmation offers undo (`RELY.4`).
- A secondary action on every result opens its details.

### FIND-R — Return to what we've played

**FIND.9a** As a **Resumer**, I want recently played items from every screen, so that something played on the TV last night is still easy to find.
- Recent items include things played on any screen in the house, each marked with where it last played.
- A recent item offers the same actions as any other item (details, play, line up, send elsewhere).
- Tapping a recent item never replaces a lineup without the same confirmation and undo as any other play.

**FIND.10a** As a **Resumer**, I want to see unfinished things and next episodes, so that I can carry on without searching.
- Unfinished items show where they stopped (for example, "34 min left", "Chapter 7").
- For a series, the next unwatched episode is offered.
- Anything already playing on this device is not offered as "carry on".
- Finished items drop off the list on their own.

---

### PLAY-S — Start something

**PLAY.1a** As a **Seeker**, I want "play now" to play at my aim, whichever control I use, so that the same word always does the same thing.
- "Play now" on a search result, a browsed item, an item's details, a suggestion, or a recent item all play at the aim shown on screen.
- The item starts and replaces what was playing on that screen.
- A confirmation names the item and the screen (see `RELY.1`).
- If the screen is busy with someone else's playback, I'm told what I'm about to replace before it happens (see `PLACE.5`).

**PLAY.1b** As a **Hand-Held Viewer**, I want "play now" to start here when my aim is this device, so that I stay in control of what's in my hands.
- With the aim on this device, every "play now" starts on this device; no other screen changes.
- Playback starts without leaving the part of the app I'm in; a compact handle appears (see `STEER.1`).

**PLAY.2a** As a **Wanderer**, I want to play a whole show or album in order, so that I don't pick each part.
- A whole-collection "play" is available wherever the collection appears (result, browse, details).
- Playback starts at the first part (or the first unfinished part; see `PLAY.4`) and the lineup lists the rest in order.
- The confirmation names the collection, the number of items, and the screen.

**PLAY.3a** As a **Lineup Builder**, I want to shuffle a whole collection in one step, so that it plays in a fresh order.
- "Shuffle" is offered beside "play" on every collection, wherever it appears.
- The lineup shows the shuffled order and shuffle reads as on.
- Shuffling a collection doesn't change shuffle for anything I start later.

**PLAY.4a** As a **Resumer**, I want to choose between continuing and starting over, so that I get the position I meant.
- When an item has a saved position, "play" offers continue (with the position) and start over.
- Continue picks up within a few seconds of where it stopped, even if it last played on a different screen.
- When there's no saved position, there's no extra question.

### PLAY-L — Line things up

**PLAY.5a** As a **Lineup Builder**, I want one clear "play next" action, so that I know exactly where the item goes.
- There is one "play next" verb, available on every item wherever it appears.
- The item appears immediately after what's playing now; if I add several, they play in the order I added them (Q4).
- The confirmation names the item, "next", and the screen whose lineup it joined.

**PLAY.6a** As a **Seeker**, I want to add something to the end without interrupting, so that the current playback isn't disturbed.
- "Add to lineup" is available on every item wherever it appears and uses the aim.
- What's playing continues without a pause or skip.
- The confirmation names the item, its position ("7th"), and the screen.

**PLAY.6b** As a **House Watch**, I want to add a single item to another screen's lineup, so that the kids' room gets one more episode without me walking in.
- With another screen as the aim (or via "add to…" on the item), the item joins that screen's lineup.
- That screen's lineup visibly includes the new item when I look.

**PLAY.7a** As a **Lineup Builder**, I want to add a whole album or season to the lineup, next or at the end, so that I can build long lineups quickly.
- Whole-collection "play next" and "add to lineup" are available wherever a collection appears.
- The confirmation states how many items were added and where.
- The added items keep their natural order.

---

### PLACE-A — Aim at a screen

**PLACE.1a** As a **Big-Screen Sender**, I want the aim shown next to every play action, so that I know where a tap will go before I tap.
- Everywhere a play or line-up action appears, the aim is visible on the same screen, on every device size.
- The aim uses the screen's name and room ("Living Room TV"), or "This device", or "3 screens".
- What the aim says is always what happens. No control ignores it.
- When I'm steering another screen, the aim is still shown as its own thing and does not change unless I change it (see Tension T2).

**PLACE.2a** As a **Big-Screen Sender**, I want to aim at a TV for the evening, so that every play goes there without extra steps.
- I can change the aim in one step from wherever the aim is shown.
- The chosen aim persists as I move around the app and after a reload.
- After a stretch of no use, the aim returns to "this device" on its own, so a phone is never left aimed at a TV for days (Q1).
- Every play and line-up action then uses it (see `PLAY.1a`).

**PLACE.2b** As a **Hand-Held Viewer**, I want to aim back at this device in one step, on any device, so that I'm never stuck sending to a TV.
- "This device" is always one of the choices, on phone, tablet, and laptop alike.
- Choosing it immediately updates the aim everywhere it is shown.
- Starting fresh (`RELY.8`) also offers to return the aim to this device.

**PLACE.3a** As a **Big-Screen Sender**, I want to send a single item to a different screen without changing my aim, so that one-off exceptions are painless.
- Every item, wherever it appears, offers "play on…" (and "add to lineup on…").
- Choosing a screen sends only that item there; the aim reads the same afterwards.
- The confirmation names the item and the screen it went to.

**PLACE.4a** As a **Big-Screen Sender**, I want to play on several screens at once, so that the whole ground floor hears the same thing.
- When choosing a screen, I can choose more than one, with the choice clearly labelled as "several screens".
- The aim then reads, for example, "Kitchen + Living Room".
- Progress and confirmation are shown per screen, so one failing doesn't hide the others succeeding.
- The screens start at about the same time, then each is steered on its own; they may drift apart (Q8).

**PLACE.5a** As a **Big-Screen Sender**, I want to see what each screen is doing while I choose, so that I don't interrupt someone.
- Each choice shows the screen's name, room, and whether it is playing (with title and time left), paused, idle, or off.
- Screens that haven't reported recently are marked as uncertain.
- Choosing a screen that is playing someone else's content warns me what will be replaced before it happens.

**PLACE.6a** As a **Room Hopper**, I want to decide, when I send, whether this device stops or keeps playing, so that I get a hand-off or a second room on purpose.
- Whenever sending would affect something already playing on this device, the choice between "move it" and "keep playing here too" is shown at that moment, on every device size.
- My usual choice is remembered and pre-selected, and visible before I confirm.
- Afterwards, this device does exactly what the choice said.

### PLACE-M — Move what's playing

**PLACE.7a** As a **Room Hopper**, I want to bring what's playing on the TV to the device in hand, so that I can carry on as I leave the room.
- Wherever I can see another screen's playback (the house overview or its controls), "move to this device" is offered.
- This device starts the same item at the same moment with the same lineup; the other screen stops.
- A confirmation says it moved, and from where.
- If it can't move, I'm told why and the other screen keeps playing.
- Video, audio, and photo slideshows move at the same spot; a live channel or camera simply starts fresh on the new screen (Q5).

**PLACE.8a** As a **Room Hopper**, I want to send what's playing here to a TV at the same moment, so that I switch to the big screen without starting over.
- From the handle on my own playback, "move to…" is offered, wherever I am in the app.
- The chosen screen starts at the same moment with the same lineup.
- This device stops or keeps playing according to `PLACE.6`.
- Progress and confirmation follow `RELY.2` and `RELY.3`.

**PLACE.9a** As a **House Watch**, I want to move playback between two other screens, so that I can follow a programme into another room.
- From another screen's controls, "move to…" lists other screens, including this device.
- The destination picks up at the same moment; the original stops.
- Both screens' states update in the house overview.

---

### STEER-H — Keep hold of what's playing

**STEER.1a** As a **Hand-Held Viewer**, I want a persistent handle on what's playing here, so that I can steer it from anywhere in the app.
- While anything is playing or paused on this device, a compact handle is visible in every part of the app with title, picture, progress, and play/pause.
- Tapping it opens full controls and the lineup.
- When full controls are open, the compact handle doesn't duplicate them.

**STEER.1b** As a **House Watch**, I want to steer another screen with the same controls I use for this device, so that I don't learn two ways.
- Opening another screen's playback shows the same controls, in the same layout, with that screen's name clearly at the top.
- Controls the screen can't support are shown as unavailable with a short reason, not missing.
- It is always obvious which screen I am steering, and I can switch to another in one step.
- Leaving the controls of another screen never changes my aim.
- When I pause, change, or take over another screen's playback, that screen shows a brief note saying where it came from, for example "Paused from Dad's phone" (Q7).

**STEER.1c** As a **Big-Screen Sender**, I want to go from "it's playing on the TV" straight to steering it, so that I can adjust it right away.
- The confirmation that something started on a screen offers "steer it" (see `RELY.3`).
- The same route is available afterwards from the house overview, with no time limit.

**STEER.2a** As a **Hand-Held Viewer**, I want to expand video to fill the screen and shrink it back, so that I can watch properly and still browse.
- Video can be expanded to fill the screen (or the whole display) in one step.
- Shrinking it keeps playing without a pause or restart.
- Audio-only playback shows a picture and title when expanded.

### STEER-T — Control playback

**STEER.3a** As a **House Watch**, I want to pause, resume, and skip on any screen, so that I can react to the room.
- Play/pause is one control that shows whether it is playing or paused.
- Skip forward and back are available for any lineup.
- After a press, the control reflects the change within a couple of seconds, or tells me it hasn't happened yet.

**STEER.4a** As a **Hand-Held Viewer**, I want to scrub and jump a few seconds back or forward, so that I can catch what I missed.
- A position bar can be dragged; the time is shown while dragging.
- Jump back and forward buttons are present for every playback, local or on another screen.
- Live content shows that it's live and offers "go to live" instead of a position.

**STEER.5a** As a **House Watch**, I want to change volume and speed for whatever I'm steering, so that it suits the listener.
- Volume can be changed with large tap targets (steps up and down), not only by dragging, and the level is shown.
- Speed can be changed for spoken word and video wherever the screen supports it.
- Changes take effect on the screen being steered, not on this device.

**STEER.6a** As a **Fixer**, I want to stop playback and know what stopping leaves, so that I don't lose a lineup by accident.
- There is one "stop" control, meaning the same thing everywhere.
- After stopping, I'm told what remains ("Lineup kept: 8 items") and can reopen it.
- Emptying the lineup is a separate, clearly named action (`STEER.8`).

### STEER-Q — Shape the lineup

**STEER.7a** As a **Lineup Builder**, I want to open the lineup for any playback from anywhere, even after it stops, so that I always know what's next.
- The lineup is reachable in one step from the handle on my playback and from any screen's controls.
- It's still reachable after stopping, until I clear it or start fresh.
- It shows what's playing now, what's next (including items placed "next"), and a count.
- Photos have a queue like video and audio; a live channel or camera is a single thing with no queue or position (Q5).

**STEER.8a** As a **Lineup Builder**, I want to reorder, jump to, remove, and clear lineup items, so that the order is exactly right.
- I can move an item up or down, or drag it, and the new order shows immediately.
- Tapping an item plays it now.
- Removing one item or clearing all can be undone for a short time (see `RELY.4`).
- These work identically for this device and another screen.

**STEER.9a** As a **Lineup Builder**, I want to set repeat and shuffle once, in one place, so that it plays on the way I want.
- Repeat (off, all, one) and shuffle each appear once, alongside the lineup, and show whether they are on.
- Changing them doesn't interrupt what's playing.
- They behave the same for any screen.

---

### HOUSE-O — Overview

**HOUSE.1a** As a **House Watch**, I want a glanceable sign of what's playing around the house from anywhere in the app, so that I notice without going looking.
- One house indicator is visible everywhere in the app, on every device size, shown once.
- It states how many screens are playing (and whether any are paused).
- Opening it shows the full overview in one step.

**HOUSE.2a** As a **House Watch**, I want to see what every screen is doing, all together, so that I understand the house at once.
- Each screen shows its name, room, whether it is playing, paused, idle, or off, and, when playing, picture, title, and progress.
- From any screen in the overview I can open its controls (`STEER.1b`), move its playback here (`PLACE.7`), or play something on it (`PLACE.3`).
- Screens that are playing appear before idle and off ones.

**HOUSE.2b** As a **Room Hopper**, I want to see this device alongside every other screen in the overview, so that the house picture is whole.
- This device appears in the overview, marked as "this device".
- What it shows matches what other people see for it from their devices.

**HOUSE.3a** As a **House Watch**, I want to know when information might be out of date, so that I don't act on old news.
- A screen that hasn't reported recently is marked with when it was last heard from.
- If this device loses touch with the house, the whole overview says so, and recovers on its own.
- Controls on an uncertain screen say that the result may not be confirmed.

### HOUSE-K — Know the screens

**HOUSE.4a** As a **Routine Setter**, I want every screen, including browsers, to have a human name, so that people and routines can pick the right one.
- Every screen is listed under a name like "Kitchen tablet" or "Dad's laptop", never a code.
- Anyone can name or rename a device from within the app; TVs and kiosks come already named (Q10).
- The name stays the same across reloads and appears everywhere the screen is mentioned.

**HOUSE.5a** As a **House Watch**, I want to see whether a person or a routine started something, so that unexpected playback makes sense.
- A screen's playback shows how it started, for example "Started by kitchen button, 7:02".
- The same note appears in the screen's controls.

---

### RELY-C — Know my action worked

**RELY.1a** As a **Seeker**, I want every play, add, and send to confirm in the same way, so that I never wonder whether a tap worked.
- Every action that changes what's playing or lined up gives a short confirmation naming the item and the screen.
- The same outcome confirms the same way, whichever control started it, on every device size.
- When the result is already obvious on this device (it visibly starts playing here), the confirmation is brief and unobtrusive.
- Confirmations don't pile up; a newer one replaces an older one of the same kind.

**RELY.2a** As a **Big-Screen Sender**, I want to see progress while a TV turns on and loads, so that waiting doesn't feel like failure.
- While a far screen gets ready, I see its steps in plain words ("Turning on", "Loading").
- Progress is visible wherever I go in the app until the outcome is known.
- The wording fits the screen type (it doesn't say "TV" for a speaker).

**RELY.3a** As a **Big-Screen Sender**, I want to know it actually started, so that I can put the phone down.
- When playback is confirmed, I see "Playing on Living Room TV" with a way to steer it.
- If it can't be confirmed, I'm told it may not have started, with options to check (steer it) or try again.
- An unconfirmed outcome stays visible until I dismiss it.

**RELY.4a** As a **Lineup Builder**, I want to undo my last change, so that a slip costs nothing.
- After replacing what's playing, removing, or clearing, an undo is offered for a short time.
- Undo restores the previous item, position, and lineup on that screen.
- Truly irreversible actions (starting fresh) ask first instead of offering undo.

### RELY-R — Recover when it goes wrong

**RELY.5a** As a **Hand-Held Viewer**, I want to be told when playback fails or skips an item, wherever I am, so that silence never hides a problem.
- A failure shows a notice naming the item and screen, in plain words, even if I'm in another part of the app.
- If an item was skipped because it failed, the notice says so and what's playing instead.
- The handle on my playback shows a problem sign until things recover.
- The same applies to failures on other screens I started or am steering.

**RELY.6a** As a **Fixer**, I want to retry exactly the attempt that failed, so that fixing it is one step.
- Every failure notice has its own retry, which retries that attempt (same item, same screen), no other.
- Next to retry, I can choose another screen for that attempt.
- Several failures are each shown separately with their own retry.

### RELY-K — Keep my place

**RELY.7a** As a **Hand-Held Viewer**, I want everything to survive a reload or a network hiccup, so that I don't lose my place.
- After a reload or crash, what was playing, its position, its lineup, repeat and shuffle, and my aim are all as they were.
- A brief network hiccup doesn't reload the app or interrupt what I'm doing; I see a quiet "reconnecting" note if it lasts.
- The part of the app I was in is restored.

**RELY.8a** As a **Fixer**, I want to start fresh knowing what will be cleared, so that I get a clean slate without surprises.
- "Start fresh" is findable where a person would expect settings for this device.
- It lists exactly what will be cleared (what's playing, lineup, position, aim) and lets me keep some of it.
- It asks for confirmation, then everything reads as new.

### RELY-O — Stay oriented

**RELY.9a** As a **Wanderer**, I want to know where I am and move between the main areas, so that I never feel lost.
- The current area is always highlighted, including when I'm in the lineup or another screen's controls.
- Choosing the area I'm already in takes me to its top, without adding extra steps to going back.

**RELY.10a** As a **Wanderer**, I want "back" to retrace my steps, so that I can find my way out.
- Back, whether the device's own back or an on-screen one, goes one step to where I actually came from.
- Any on-screen back is labelled with where it goes, and goes there.
- Closing a pop-up counts as one back.

---

### AUTO-T — Start from a trigger

**AUTO.1a** As a **Routine Setter**, I want a button, tag, or routine to start content on a named screen, so that the house does the right thing with nobody at a screen.
- When the trigger fires, the named screen starts the chosen item, lineup, or shuffled collection, with the chosen volume.
- It starts within the same few seconds a person's send would.
- Progress and failures are reported like any other send, visible to anyone looking at that screen in the overview (see `HOUSE.5`).

**AUTO.1b** As a **Hand-Held Viewer**, I want a routine to be able to start playback on the device I left open on the wall, so that the kitchen tablet can play the morning programme.
- Any named device left open in the app can be a target for routines (Q10).
- Playback started this way appears on that device as if someone had started it there.

**AUTO.2a** As a **Routine Setter**, I want repeated or overlapping triggers to give one predictable result, so that routines don't pile up.
- Firing the same trigger twice in quick succession doesn't start it twice or add duplicates to the lineup.
- Reloading a device that a routine started doesn't restart the routine's content from the beginning.
- A person's action on that screen after a routine always takes effect; the routine doesn't fight it.

### AUTO-O — Let the house know

**AUTO.3a** As a **House Watch**, I want every screen, including browsers, to report what it's playing to the rest of the house, so that the overview and household displays are complete.
- Anything playing on any device in the app appears in the overview and on other household displays.
- When a device stops or is closed, it shows as stopped soon after, not as still playing.
- A person using the app on a device can see that it is visible to the house.

**Totals:** 62 user stories across 53 jobs.

---

## 4. Mappings

### 4.1 Persona × job-group matrix

**P** Primary · **S** Secondary · **R** Rare · **N** Never

| Group | P1 Wanderer | P2 Seeker | P3 Sender | P4 House Watch | P5 Hand-Held | P6 Lineup Builder | P7 Room Hopper | P8 Routine Setter | P9 Resumer | P10 Fixer |
|---|---|---|---|---|---|---|---|---|---|---|
| FIND-S Look for something I can name | S | **P** | S | S | S | **P** | R | R | R | R |
| FIND-E Explore without a title | **P** | S | S | R | S | **P** | N | R | S | N |
| FIND-L Understand before choosing | **P** | S | R | N | S | S | N | R | S | N |
| FIND-R Return to what we've played | S | S | R | R | S | S | R | N | **P** | R |
| PLAY-S Start something | **P** | **P** | **P** | S | **P** | S | R | S | **P** | R |
| PLAY-L Line things up | R | S | S | R | S | **P** | N | S | S | N |
| PLACE-A Aim at a screen | S | S | **P** | S | S | S | S | S | S | S |
| PLACE-M Move what's playing | R | R | S | S | R | R | **P** | N | S | S |
| STEER-H Keep hold of what's playing | S | S | S | **P** | **P** | S | **P** | R | S | **P** |
| STEER-T Control playback | R | R | S | **P** | **P** | S | S | R | S | **P** |
| STEER-Q Shape the lineup | R | R | S | S | S | **P** | S | R | S | S |
| HOUSE-O Overview | R | R | S | **P** | R | R | **P** | S | S | **P** |
| HOUSE-K Know the screens | N | R | S | **P** | R | R | S | **P** | R | S |
| RELY-C Know my action worked | S | **P** | **P** | S | S | **P** | **P** | **P** | S | **P** |
| RELY-R Recover when it goes wrong | R | S | **P** | S | S | S | S | **P** | S | **P** |
| RELY-K Keep my place | R | R | R | R | **P** | S | S | S | **P** | S |
| RELY-O Stay oriented | **P** | S | S | S | S | S | R | N | R | S |
| AUTO-T Start from a trigger | N | N | N | R | R | N | N | **P** | N | R |
| AUTO-O Let the house know | N | N | R | S | N | N | R | **P** | N | R |

Reading the matrix:
- **PLACE-A is at least Secondary for every persona.** Everyone relies on knowing where things will play, which is why it must be a single, always-visible concern rather than a feature of some buttons.
- **RELY-C is Primary for six personas.** Confirmation is not polish; it is the most widely shared need in the model.
- **STEER-H is Primary for four very different personas** (House Watch, Hand-Held Viewer, Room Hopper, Fixer). One way of holding and steering any playback serves all of them.

### 4.2 Persona → larger job → jobs and stories, in path order

| Persona | Larger job | Path (job / story IDs, in order) |
|---|---|---|
| **P1 Wanderer** | WA-1 Find something that suits the moment | FIND.7a → FIND.5a → FIND.6a → RELY.10a |
| | WA-2 Check it's right | FIND.8a → PLAY.4a |
| | WA-3 Get it playing where everyone is | PLACE.1a → PLAY.1a or PLAY.2a → RELY.1a → RELY.2a → RELY.3a |
| **P2 Seeker** | SK-1 Name → playing, fast | FIND.1a → FIND.3a → PLACE.1a → PLAY.1a → RELY.1a |
| | SK-2 Narrow an ambiguous name | FIND.1a → FIND.2a → FIND.4a → FIND.8b |
| | SK-3 Queue it instead | FIND.1a → PLACE.1a → PLAY.5a or PLAY.6a → RELY.1a → STEER.7a |
| **P3 Big-Screen Sender** | BS-1 Aim at a TV for the evening | PLACE.5a → PLACE.2a → PLACE.1a → PLAY.1a → RELY.2a → RELY.3a |
| | BS-2 Send one thing elsewhere | FIND.1b → PLACE.3a → PLACE.5a → RELY.1a |
| | BS-3 Know it started; fix it if not | RELY.2a → RELY.3a → STEER.1c → RELY.5a → RELY.6a |
| | BS-4 Aim back at the phone | PLACE.1a → PLACE.2b |
| **P4 House Watch** | HW-1 Glance at the house | HOUSE.1a |
| | HW-2 See each screen, trust it's current | HOUSE.2a → HOUSE.3a → HOUSE.4a → HOUSE.5a |
| | HW-3 Steer or change a screen from afar | HOUSE.2a → STEER.1b → STEER.3a → STEER.5a → STEER.6a → PLAY.6b → RELY.1a |
| **P5 Hand-Held Viewer** | HH-1 Play on the device in hand | PLACE.1a → PLACE.2b → PLAY.1b → RELY.1a |
| | HH-2 Keep control while doing other things | STEER.1a → STEER.3a → STEER.7a → RELY.5a |
| | HH-3 Watch big, steer precisely | STEER.2a → STEER.4a → STEER.5a → RELY.7a |
| **P6 Lineup Builder** | LB-1 Build a lineup without interrupting | FIND.1a → FIND.6a → PLACE.1a → PLAY.5a → PLAY.6a → PLAY.7a → RELY.1a |
| | LB-2 Arrange it | STEER.7a → STEER.8a → STEER.9a → RELY.4a |
| | LB-3 Build another screen's lineup | HOUSE.2a → STEER.1b → PLACE.3a → PLAY.6b → STEER.7a |
| **P7 Room Hopper** | RH-1 TV → device in hand | HOUSE.2a → STEER.1b → PLACE.7a → RELY.1a |
| | RH-2 Device in hand → TV | STEER.1a → PLACE.8a → PLACE.5a → PLACE.6a → RELY.2a → RELY.3a |
| | RH-3 Between two other screens | HOUSE.2a → STEER.1b → PLACE.9a → HOUSE.2b |
| **P8 Routine Setter** | RS-1 Trigger starts content on a screen | HOUSE.4a → AUTO.1a → AUTO.1b → AUTO.2a |
| | RS-2 Triggered starts behave like a person's | AUTO.3a → HOUSE.2a → HOUSE.5a → STEER.1b → RELY.2a → RELY.5a |
| | RS-3 Stable, human screen names | HOUSE.4a |
| **P9 Resumer** | RE-1 Find the unfinished thing | FIND.10a → FIND.9a |
| | RE-2 Continue or start over, on the screen at hand | PLACE.1a → PLAY.4a → RELY.7a |
| | RE-3 Go on to the next part | FIND.10a → STEER.7a |
| **P10 Fixer** | FX-1 Find out what went wrong | RELY.5a → RELY.2a → HOUSE.3a |
| | FX-2 Retry or redirect that attempt | RELY.6a → PLACE.3a → RELY.3a |
| | FX-3 Stop it, or undo what I did | HOUSE.2a → STEER.1b → STEER.6a → STEER.7a → RELY.4a |
| | FX-4 Back to a clean start | RELY.8a → PLACE.2b |

### 4.3 Crosswalk to the audit

**Ideal job → audit jobs absorbed**

| Ideal job | Audit jobs | Note |
|---|---|---|
| FIND.1 | A1, G4 | One search; the device-card search path of G4 folds in here. |
| FIND.2 | A2 | |
| FIND.3 | A3 | |
| FIND.4 | A2, A3 | Widening an empty narrowed search, and what an empty result says, made a job of their own. |
| FIND.5 | A4 | Adds pictures and a no-typing route by kind. |
| FIND.6 | A5 | |
| FIND.7 | — | **New.** No counterpart. The audit only asks what the start page is for. |
| FIND.8 | A6 | Details become reachable from every item. |
| FIND.9 | A7 | Extended to everything played on any screen, not just this device. |
| FIND.10 | B2 (part) | **Partly new:** next episode or chapter has no counterpart. |
| PLAY.1 | B1, G4 | |
| PLAY.2 | C3 | |
| PLAY.3 | C4 (part) | The start-a-shuffled-collection half of C4. |
| PLAY.4 | B2 (part) | **Partly new:** an explicit continue-or-start-over choice. |
| PLAY.5 | C1 | Two verbs merged into one. |
| PLAY.6 | C2, G5 | A single item added to any screen's lineup. |
| PLAY.7 | C2, G5 | The whole-collection "add" half of each. |
| PLACE.1 | D1 | |
| PLACE.2 | D2 | |
| PLACE.3 | D3, G4 | |
| PLACE.4 | D4 | |
| PLACE.5 | F4 | Moved from "know the house" to "choose where": it serves the choice. |
| PLACE.6 | D5 | |
| PLACE.7 | H1 | |
| PLACE.8 | H2 | |
| PLACE.9 | — | **New.** Moving between two other screens is not served at all. |
| STEER.1 | B3, E4, K3, G1 (part) | Holding, reaching, and choosing which playback to steer. |
| STEER.2 | B6 | |
| STEER.3 | B4, G1 | This device and other screens merged. |
| STEER.4 | B5, G2 | Position, split from volume and speed. |
| STEER.5 | B5, G2 | Volume and speed, for any screen. |
| STEER.6 | B7, G1 (part) | |
| STEER.7 | C5, G3, K3 (part) | Seeing the lineup, reachable after stopping. |
| STEER.8 | C5, G3 | Editing the lineup. |
| STEER.9 | C6, C4 (part) | Repeat and the shuffle setting, in one place. |
| HOUSE.1 | F1 | |
| HOUSE.2 | F2 | |
| HOUSE.3 | F3 | |
| HOUSE.4 | J3 | Moved from "automations" to "know the screens": people need names too. |
| HOUSE.5 | — | **New.** Who or what started playback. |
| RELY.1 | — (cross-cutting evidence in A1, B1, C2, C3, H1) | **Partly new:** the audit records the inconsistency but has no job for uniform confirmation. |
| RELY.2 | E1 | |
| RELY.3 | E2 | |
| RELY.4 | — | **New.** Undo for replace, remove, and clear. |
| RELY.5 | I4 | Extended to every part of the app and to other screens. |
| RELY.6 | E3 | Adds redirecting a failed attempt to another screen. |
| RELY.7 | I1, I3, B2 (part) | Keeping everything through reloads and network hiccups. |
| RELY.8 | I2 | |
| RELY.9 | K1 | |
| RELY.10 | K2 | |
| AUTO.1 | J1 | |
| AUTO.2 | J1 (part) | **Partly new:** override by people, and repeat-safety as a visible outcome. |
| AUTO.3 | J2 | Reframed as house-wide rather than "this browser". |

**Every audit job lands somewhere.** A1–A7, B1–B7, C1–C6, D1–D5, E1–E4, F1–F4, G1–G5, H1–H2, I1–I4, J1–J3, K1–K3 are all absorbed above.

**Split**
- **B2** Pick up where I left off → FIND.10 (what's unfinished), PLAY.4 (continue or start over), RELY.7 (survive a reload). Three different needs shared one label.
- **B5** Scrub, speed, volume → STEER.4 (position) and STEER.5 (how it sounds and plays).
- **C2** Add to the end → PLAY.6 (one item) and PLAY.7 (a collection).
- **C4** Shuffle → PLAY.3 (start a collection shuffled) and STEER.9 (the shuffle setting of a running lineup). One is a way to start, the other a way to steer.
- **G1** Control a device → STEER.1 (which playback), STEER.3 (transport), STEER.6 (stop).
- **K3** Get to the lineup → STEER.1 and STEER.7.
- **J1** Start from an automation → AUTO.1 (the start) and AUTO.2 (predictable when repeated or overridden).

**Merged**
- **B4 + G1**, **B5 + G2**, **C5 + G3**, **B7 + G1 stop**: this device and other screens share one set of steering jobs. The audit's division by *which screen* is a mechanism, not a need.
- **C6 + the C4 toggle** → STEER.9: repeat and shuffle live once.
- **B3 + E4 + K3** → STEER.1: "hold on to what's playing and reach its controls" was spread across three routes.
- **I1 + I3** → RELY.7: to a person, a reload and a network hiccup are the same worry.
- **C1**: "Play Next" and "Up Next" become one verb.

**Dissolved (no standalone ideal job)**
- **G4** Put something on a specific device → FIND.1 + PLAY.1 + PLACE.3. Four routes existed because "where" was welded to "what". With PLACE owning "where", this is not a separate job.
- **G5** Add to a device's lineup → PLAY.6 / PLAY.7 at a chosen screen. Same reasoning.
- **K3** as a navigation job: reaching the lineup is a property of STEER, not a destination to navigate to.

**Moved between concerns**
- **F4** from house awareness to PLACE.5, because it only matters while choosing.
- **J3** from automations to HOUSE.4, because people choosing a screen need names as much as routines do.

**Needs the current app does not serve at all**
- FIND.7 Suggestions for the moment
- PLACE.9 Move playback between two other screens
- HOUSE.5 Who or what started it
- RELY.4 Undo
- Partly new: FIND.10 (next episode), PLAY.4 (explicit continue or start over), RELY.1 (uniform confirmation), AUTO.2 (override and repeat-safety)

### 4.4 Tensions and the principles that resolve them

| # | Tension | Who pulls which way | Principle |
|---|---|---|---|
| T1 | **Where a plain "play" goes** | Big-Screen Sender wants taps to go to the TV by default. Hand-Held Viewer wants them to stay here. | **One aim, owned by the device in hand, always visible, always one step from "this device".** Neither default is imposed on the house: each device carries its own aim, a device new to the app starts aimed at itself, the aim returns to itself after a stretch of no use (Q1), and every play action shows the aim beside it (PLACE.1, PLACE.2). Sending elsewhere once never needs the aim changed (PLACE.3). |
| T2 | **Does steering a screen also aim at it?** | House Watch in a TV's controls expects a search result to go to that TV. Seeker expects the aim they set to hold. | **Steering is not aiming.** What you're steering (STEER.1) and where new things go (PLACE.1) are separate and both on screen. A visible shortcut can offer "aim here too", but nothing changes silently. |
| T3 | **What a tap on a result does** | Seeker wants it to play. Wanderer wants to look first. | **One consistent main action per kind of result, with details always one step away** (FIND.8b). Collections open; playable items play at the aim (Q2), identically everywhere, with undo covering a mis-tap. |
| T4 | **Power vs safety on the lineup** | Lineup Builder wants instant reorder, remove, clear. Fixer wants nothing destroyed by accident. | **Undo instead of asking.** Reversible changes happen instantly and offer undo (RELY.4). Only truly irreversible actions ask first (RELY.8). |
| T5 | **Sending to a busy screen** | Big-Screen Sender wants it to just work. Whoever is watching that screen doesn't want to be cut off. | **Warn before replacing someone else's playback; never block.** The choice shows what will be interrupted (PLACE.5), and undo can restore it (RELY.4). |
| T6 | **Move or keep when sending** | Room Hopper wants this device to stop. A Sender starting a second room wants it to keep playing. | **Decide at the moment, with the remembered choice visible.** The keep-or-move choice appears whenever it applies, on every device size, pre-set to the last choice (PLACE.6). |
| T7 | **Routines vs people in the room** | Routine Setter wants predictable results. People in the room want to change what's on. | **Routines are just another starter; the latest person wins.** Routine starts are shown as such (HOUSE.5), steered like anything else (STEER), and never override a later human action (AUTO.2). |
| T8 | **How loud confirmation is** | Seeker wants no clutter. Sender and Fixer want certainty. | **Confirmation scales with distance; failure is always loud.** Quiet when the result is in your hands, explicit with progress when it's on another screen, and always a clear notice when something fails (RELY.1–RELY.5). |
| T9 | **Whose history** | Resumer wants everything the house played, including the TV. A Hand-Held Viewer may not want their late-night listening on the family list. | **One household list, always labelled with where it played** (Q3). |
| T10 | **Remembering a narrowed search** | A Seeker who narrows to Music wants it kept while they work. The next Seeker is confused by results limited to Music. | **Narrowing is always visible, and an empty narrowed search widens with a note.** Narrowing lasts until search closes (Q6), the same on every device. |

---

## 5. Owner decisions

The open questions from the first draft, answered by the owner on 2026-09-14. Each decision is applied to the stories and tensions listed.

| # | Question | Decision | Applied to |
|---|---|---|---|
| Q1 | Should a device's aim return to "this device" on its own? | **Yes, after idle time.** The aim holds while the app is in active use; after a stretch of no use it returns to "this device". | PLACE.2a, T1 |
| Q2 | What does tapping a result do? | **Depends on the kind of thing.** A collection (show, season, album, playlist, artist, folder) opens. A playable item (episode, song, film) plays at the aim. Details are a secondary action on every item; undo covers a mis-tap. | FIND.7a, FIND.8b, T3 |
| Q3 | Whose history, unfinished items, and suggestions? | **One household list**, each item labelled with where it played. No "who's watching". | FIND.7, FIND.9, FIND.10, T9 |
| Q4 | Order of several "play next" items? | **The order they were added.** | PLAY.5a |
| Q5 | Do photos, live channels, and cameras have queues, positions, and moves? | **Photos queue** like video and audio (a slideshow). **Live channels and cameras are tuned**: no queue, no position, started fresh when sent to another screen. | STEER.7a, PLACE.7a |
| Q6 | How long does a narrowed search kind last? | **Until search closes.** The next search starts at All. Same on every device. | FIND.2a, T10 |
| Q7 | Should people watching a screen get a sign when someone elsewhere changes it? | **A brief note on that screen** naming where the change came from. No permission step. | STEER.1b |
| Q8 | How do several screens playing at once behave? | **Start together, steered separately.** They may drift apart; there is no group control. | PLACE.4a |
| Q9 | Which words go in the product? | **Play on · Queue · Remote.** | Words table |
| Q10 | Who may name a screen, and which screens can routines target? | **Anyone can name a device** from the app; TVs and kiosks come already named. **Any named screen**, including a browser left open on a wall tablet, can be a routine target. | HOUSE.4a, AUTO.1b |
| Q11 | Should children be limited in what or where they can play? | **Out of scope for this redesign.** Revisit as its own concern if needed. | — |
