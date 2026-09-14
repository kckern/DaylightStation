# Media App: Ideal Jobs-to-be-Done Taxonomy

**Date:** 2026-09-14
**Status:** Proposal. A model of the jobs the app should serve. No screens designed yet. The owner's decisions on the open questions are recorded in §5, and the changes adopted from the adversarial review in §6; both are applied throughout.
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
| **Queue** | What is playing on a screen plus what is coming up next on that screen. |
| **Steer** | Control something that is already playing (pause, skip, volume, reorder the queue). |
| **Send** | Start content on, or move playback to, a screen other than this device. |

**Words on screen (decided, Q9 and R28):** buttons say **Play**, **Play next**, **Add to queue**, **Play on…**, and **Move to…**, and controlling another screen is called **Remote**. This document says *queue* throughout, and keeps *send*, *aim*, and *steer* as working terms.

---

## 1. Personas

Fifteen modes of intent. The eight the owner named, sharpened; two the audit evidence supports, the **Resumer** (picks something back up; audiobooks, series, a film stopped halfway) and the **Fixer** (something has gone wrong and needs putting right fast); and five added after the adversarial review (R45): the **Bystander**, **Ambient listener**, **Host**, **Setup person**, and **Child**.

| # | Persona | In one line |
|---|---|---|
| P1 | **Wanderer** (Browser) | No title in mind; wants to be shown something good. |
| P2 | **Seeker** | Knows exactly what they want; types it and goes. |
| P3 | **Big-Screen Sender** (Caster) | Uses the phone as a remote to get something onto a TV or speaker. |
| P4 | **House Watch** (Device Monitor) | Wants to know what's on around the house and control it from wherever they are. |
| P5 | **Hand-Held Viewer** (In-Browser Watcher/Listener) | Plays on the device in hand, and wants it to stay there. |
| P6 | **Queue Builder** (Playlist/Queue Curator) | Shapes what plays next and in what order. |
| P7 | **Room Hopper** (Session Mover) | Moves what's playing from one room or screen to another without losing the spot. |
| P8 | **Routine Setter** (Automation Author) | Wants the house to start the right thing on the right screen with nobody touching anything. |
| P9 | **Resumer** | Comes back to something unfinished and wants to be exactly where they left off. |
| P10 | **Fixer** | Something is wrong (wrong screen, nothing started, stuck playing) and they want it fixed now. |
| P11 | **Bystander** | At the screen someone else just changed; may never open the app. |
| P12 | **Ambient listener** | Wants something pleasant playing all day, with little attention. |
| P13 | **Host** | Runs the music for a gathering; guests add, nobody wipes it. |
| P14 | **Setup person** | Looks after the household's screens and routines. |
| P15 | **Child** | Taps pictures, can't read warnings, wants the same favourite again. |

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
- **SK-3:** On a result, chooses "play next" or "add to the end" → sees a confirmation naming the title and the screen whose queue it joined.

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
- **HH-2:** Keeps browsing → a compact handle shows title, progress, play/pause → taps it to open full controls and the queue.
- **HH-3:** Expands video to fill the screen → scrubs, jumps back 10 seconds, changes speed and volume → shrinks back to browsing without interrupting.

**Frustrations today**
- Two sets of identical buttons on the same screen (B4, C6).
- A mysterious aim at the TV that can't be undone on a phone sends their taps away (D2).
- Stopping hides the queue with no way back to it (B7, K3).
- A "resume" offer keeps appearing for the thing already playing (B2).
- Nothing tells them when playback fails and skips on (I4).

**Success signal:** It is playing in their hands, and every control they reach for is where they expect it.

---

### P6. Queue Builder (Playlist/Queue Curator)

- **Identity:** "Dinner music for the next two hours, in this order, then the kids' songs."
- **Situation:** Laptop or tablet, often before an event or while cooking. Low time pressure while building; wants the result to run unattended.

**Larger jobs**
- **LB-1** Build a queue from many searches and collections without interrupting what's playing.
- **LB-2** Arrange it: reorder, remove, jump, repeat, shuffle.
- **LB-3** Build or edit the queue of a screen other than the one in hand.

**Priorities** (ranked)
1. Every addition is confirmed and lands where they intended.
2. The queue is always reachable, including after something stops.
3. Clear, distinct verbs: "play next" vs "add to the end", one meaning each.
4. Tolerates: dense controls. Does not tolerate: a queue wiped by one tap with no way back.

**Primary paths**
- **LB-1:** Searches or browses → on each item or whole collection, chooses "add to the end" or "play next" → sees a confirmation naming the screen and position → the queue count visibly grows.
- **LB-2:** Opens the queue from anywhere → drags or moves items, removes one, sets repeat → clears it, and can undo if that was a mistake.
- **LB-3:** Chooses which screen's queue they are working on → every addition says it is joining that screen's queue → watches the queue update.

**Frustrations today**
- Additions give no confirmation (C2).
- "Play next" and "Up next" both exist with no explanation (C1).
- The queue is reachable only through the small player, and becomes unreachable after stopping (C5, K3, B7).
- Shuffle and repeat appear twice on one screen (C6).
- A single item can't be added to another screen's queue at all (G5).
- Clearing the queue happens instantly with no undo (C5).

**Success signal:** The queue reads exactly as intended, on the intended screen, and plays through unattended.

---

### P7. Room Hopper (Session Mover)

- **Identity:** "I was watching in the living room; I'm going to bed. Carry on in there."
- **Situation:** Mid-film or mid-audiobook, walking between rooms, phone in hand. Wants no fiddling and no rewinding.

**Larger jobs**
- **RH-1** Move what's playing on a TV to the device in hand, at the same moment.
- **RH-2** Move what's playing on the device in hand to a TV or speaker, at the same moment.
- **RH-3** Move playback between two other screens from the phone.

**Priorities** (ranked)
1. Exact continuity: same item, same spot, same queue.
2. The original screen stops (unless they choose otherwise).
3. Available from wherever they see the playback: the house overview, the screen's controls, their own player.
4. Tolerates: a short pause during the move. Does not tolerate: starting over, or two screens playing by accident.

**Primary paths**
- **RH-1:** Sees the TV's playback (in the house overview or its controls) → chooses "move to this device" → the TV stops, this device picks up at the same moment → a confirmation says so.
- **RH-2:** From their own player, chooses "move to…" → picks the bedroom screen, seeing what it's doing now → sees progress, then "playing in the bedroom" → this device stops (or keeps playing, if they chose that).
- **RH-3:** From the living room TV's controls, chooses "move to…" → picks the kitchen speaker → sees both screens update.

**Frustrations today**
- Pulling playback here exists only on one card in the device list, not in the device's own controls, and success says nothing (H1).
- Pushing playback to a TV is hidden below the queue on one screen only (H2).
- Moving between two other screens isn't possible at all (no audit counterpart).
- Whether this device stops after sending can't be seen on a phone (D5).

**Success signal:** They sit down in the new room and it's already playing from the right second.

---

### P8. Routine Setter (Automation Author)

- **Identity:** "Pressing the kitchen button should start the morning programme on the living room TV."
- **Situation:** Sets things up once, rarely, often on a laptop. The *outcome* is experienced later by everyone else, who never touches the app.

**Larger jobs**
- **RS-1** Have a button, tag, or routine start specific content, a queue, or a shuffled collection on a specific screen.
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
- **RE-3:** Nearing the end, sees what comes next in the series → it starts after a short countdown, unless "stop after this one" was set.

**Frustrations today**
- Recently played only covers what played on this device; anything sent to a TV never appears (A7).
- A recent item has only one action, which replaces the queue and plays here regardless of aim (A7).
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
- **FX-3:** Opens the house overview or their own player → stops the playback → sees what remains (the queue kept, ready to reopen) → or undoes the last clear or replace.
- **FX-4:** Chooses "start fresh" → is told exactly what will be cleared (queue, position, aim) → confirms → everything reads as new.

**Frustrations today**
- Retry re-sends a different attempt than the one it sits beside (E3).
- Playback failures are shown in one place only and skip on silently (I4).
- A phone can get stuck aimed at a TV, and starting fresh doesn't fix it (D2, I2).
- Stop removes the only way back to the queue (B7, K3).
- Several stop and clear controls do different things, some with confirmation, some without (B7, C5, I2).

**Success signal:** The right thing is playing (or nothing is), and they understand why.

---

### P11. Bystander

- **Identity:** "I was watching that. Who changed it?"
- **Situation:** At the TV or near a speaker, often with no phone in hand; may never have used the app. Mid-programme when someone elsewhere pauses, replaces, or moves it, or a routine starts.

**Larger jobs**
- **BY-1** Understand what just changed on this screen, and who or what changed it.
- **BY-2** Put it back without needing the device that changed it.
- **BY-3** See what's on and what's next without picking up a phone.

**Priorities** (ranked)
1. No silent, unexplained change to what they're watching.
2. Getting back what was on, at the same spot, in one step.
3. Not being pestered by notes about trivial changes.
4. Tolerates: someone pausing briefly from another room. Does not tolerate: a programme replaced with no way back.

**Primary paths**
- **BY-1:** Something changes on the screen → a brief note names the change and where it came from ("Replaced from Kid's tablet").
- **BY-2:** Presses **Put it back** on the note, or on that screen's Remote from any phone → the previous programme returns at its spot, with its queue.
- **BY-3:** Looks at the screen's own note or pause view → sees what's playing and what's next.

**Risks the review found**
- Undo lived only on the phone that made the change (R13).
- A speaker has nowhere to show a note, and every volume nudge made a note (R30).
- A doorbell camera or routine replaced the programme instead of interrupting it (R11).

**Success signal:** The programme they were watching is back, and they know who touched it.

---

### P12. Ambient listener

- **Identity:** "Just keep something nice playing in the kitchen."
- **Situation:** At home all day, hands busy. Background music or radio in one or several rooms. Glances at the app rather than looking.

**Larger jobs**
- **AL-1** Start the usual background in one step.
- **AL-2** Keep it going without the house falling silent.
- **AL-3** Find out what just played.
- **AL-4** Quiet everything at once when the doorbell or phone rings.

**Priorities** (ranked)
1. Never an unplanned silence.
2. The usual thing, one tap away.
3. Pausing everything instantly.
4. Tolerates: not choosing each track. Does not tolerate: silence mid-dinner, or hunting for the song they liked.

**Primary paths**
- **AL-1:** Opens the app → sees favourites → taps "Kitchen morning mix" → it plays at the aim.
- **AL-2:** Sets "when the queue ends: keep similar things playing" once.
- **AL-3:** Opens the speaker's queue → **Played earlier** → finds the track → adds it to favourites.
- **AL-4:** Taps **Pause all** on the handle or the house view → later **Resume all**.

**Risks the review found**
- The queue ended and the house went silent (R20).
- No way to see what played earlier, and no favourites (R40).
- No pause-everything (R18).
- Rooms drifting out of step in an open-plan space (R29).

**Success signal:** Something they like has been playing all day, and they never had to think about it.

---

### P13. Host

- **Identity:** "Dinner party tonight. Guests can add songs, but nobody wipes my playlist."
- **Situation:** An evening gathering. A laptop or phone, guests with their own phones, speakers in one or several rooms.

**Larger jobs**
- **HO-1** Set up the evening's music and protect it.
- **HO-2** Let guests add to it.
- **HO-3** Keep an eye on it and adjust it without leaving the table.

**Priorities** (ranked)
1. A guest's tap can't replace the playlist.
2. Guests' additions land in a sensible order and say where they went.
3. Guests' phones don't clutter the house list afterwards.
4. Tolerates: an odd song choice. Does not tolerate: one stranger's tap ending the evening's music.

**Primary paths**
- **HO-1:** Builds the queue (as the Queue Builder does) → turns on **Add only** for the speaker.
- **HO-2:** A guest searches and taps a song → sees "Added · 5th in line" instead of the music changing.
- **HO-3:** Glances at the handle for the speaker → skips a song or turns it down.

**Risks the review found**
- One guest tap on a song wiped a two-hour queue (R1, R39).
- Several phones pressing "Play next" with no clear order (R27).
- Guest phones lingering in the house list for weeks (R32).

**Success signal:** The playlist ran all night with the guests' additions in it, and nothing was lost.

---

### P14. Setup person

- **Identity:** "New TV in the living room. Let's get everything pointing at it."
- **Situation:** Occasional, deliberate sessions, usually on a laptop. The household member who looks after screens and routines.

**Larger jobs**
- **SU-1** Add or replace a screen, and give it a name and a room.
- **SU-2** Keep the screen list clean: duplicates, dead devices, guests.
- **SU-3** Check routines are healthy and pointed at the right screens.

**Priorities** (ranked)
1. A tidy, trustworthy list of screens, which every other persona's choices depend on.
2. Routines never break silently.
3. Changes to names or screens show their consequences before they happen.
4. Tolerates: a few careful steps. Does not tolerate: a routine silently pointed at a retired TV.

**Primary paths**
- **SU-1:** Opens the house view → adds the new TV → names it "Living Room TV" and sets its room → is shown which routines used the old TV, so they can be re-pointed → retires the old TV.
- **SU-2:** Sees "Kitchen tablet" twice → merges them into one.
- **SU-3:** Opens routine history → sees the 7:00 start failed because the tablet was asleep → fixes the tablet.

**Risks the review found**
- No job for adding, placing, merging, or retiring screens (R32).
- A rename quietly broke a routine (R31).
- A routine failed with nobody watching and nobody ever knew (R33).

**Success signal:** Every screen in the house list is real, named, and in the right room, and every routine ran this morning.

---

### P15. Child

- **Identity:** "Bluey! Again!"
- **Situation:** A pre-reader or early reader with a tablet or the family phone. Taps pictures, watches favourites over and over, often alone for a short while. Limits on children stay out of scope (Q11); this mode relies on the grown-ups' recovery paths.

**Larger jobs**
- **CH-1** Find a favourite by its picture.
- **CH-2** Start it, even after tapping it several times.
- **CH-3** Keep watching the next one.

**Priorities** (ranked)
1. Pictures, not words.
2. Things work on the first tap, and repeated taps don't cause chaos.
3. Favourites first.
4. Tolerates: nothing wordy. Does not tolerate: having to read a warning.

**Primary paths**
- **CH-1:** Opens the app → sees big favourite pictures → taps Bluey's **Play** button.
- **CH-2:** Taps it again impatiently → it still starts only once.
- **CH-3:** The episode ends → the next one starts after a countdown, unless a grown-up set "stop after this one".

**Risks the review found**
- Confirmations and warnings they can't read (R44).
- Repeated taps starting things twice (R34).
- Their viewing overwriting a parent's spot in the same film (R14).
- Late-night grown-up viewing appearing in their suggestions (R15).

**Success signal:** The show they wanted is on, and the grown-ups' places and playlists are untouched.

---
## 2. Ideal taxonomy

### 2.1 The top-level cut

Every moment of using a household media app answers one of a few separate questions. The audit shows that today the answers are tangled: "where will this play" is decided separately inside each button (A5, B1, C1, D1), "what is playing" is controlled by different buttons depending on which screen it's on (B4, G1, G2), and "did that work" depends on which control was used rather than on what happened. The cut below gives each question exactly one home.

| Domain | The question it answers | Owns | Explicitly does NOT own |
|---|---|---|---|
| **FIND** — Find something | *What is there, and which one do I want?* | Searching, narrowing, exploring, learning about an item, getting back to things played before | Owning any play verb; where things play. FIND hosts PLAY verbs on its results but owns none of them (R48). |
| **PLAY** — Decide what plays | *What should happen with this item?* | The content verbs: play now, play a whole collection, shuffle it, continue or start over, play next, add to the end | Where it plays (that is PLACE); changing a queue that already exists (that is STEER). A PLAY verb means the same thing on every item, everywhere it appears. |
| **PLACE** — Choose where it plays | *Which screen, or screens?* | The aim, knowing it before acting, one-off sends, several screens at once, keep-or-move, moving existing playback between screens | What content is chosen; controlling it once it's there. |
| **STEER** — Steer what's playing | *How do I control what's already on?* | Knowing which playback I'm steering, transport, position, volume and speed, stopping, the queue of that playback, watching big | Starting new content; the house-wide picture. One set of controls serves this device and every other screen alike. |
| **HOUSE** — See the house | *What's happening on every screen?* | The glance, each screen's detail, freshness, screen names, who or what started something | Controlling a screen (the path hands off to STEER); choosing a screen for new content (PLACE). |
| **RELY** — Rely on it | *Did it work, what went wrong, and where am I?* | Confirmation of every action, progress on far screens, failure notices, retry and undo, keeping my place through reloads and hiccups, starting fresh, orientation and going back, comfortable use for every eye, ear, and hand | Doing the actions themselves. RELY is the single voice that reports outcomes, so every action reports the same way. |
| **AUTO** — Let the house start things | *How does playback happen with nobody at a screen?* | Outcomes of buttons, tags and routines starting playback; the house knowing what each screen plays | How routines are built. Once started, automated playback is steered, seen and confirmed through STEER, HOUSE and RELY like any other. |

**Where the audit's scattered concerns now live**

| Scattered today | Clean home | What that means for a person |
|---|---|---|
| "Where does it play" decided inside every button (A5, B1, C1, C2, D1, A6, A7) | **PLACE** alone | Every PLAY verb obeys one visible aim. A one-off exception is a separate, explicit choice (`PLACE.3`). |
| Controlling "this device" vs "another screen" as different interactions (B4, B5, G1, G2) | **STEER**, for whichever playback is chosen | One set of controls, pointed at whichever playback you've chosen (`STEER.1`). |
| Being in a screen's controls silently changing where search results go (D1, G4) | Split: **STEER** knows what you're steering; **PLACE** knows where new things go | The two are never linked without saying so on screen (Tension T2). |
| Putting something on a device via four separate routes (G4) | **FIND** + **PLAY** + **PLACE** | There is no separate "play on a device" job. It is the normal find, the normal verb, and a screen choice. |
| Confirmation depending on which control was used (E1, E3, I4) | **RELY** | The same kind of outcome always reports the same way. |
| The queue reachable only through the small player (C5, K3, B7) | **STEER** queue group | The queue is a first-class thing a person can always reach, including after stopping. |
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
| | FIND.7 | Be offered favourites, unfinished things, and what this screen usually plays at this time of day — so I have somewhere to start when I have no idea. |
| **FIND-L** Understand before choosing | FIND.8 | Learn about one item (picture, description, length, kind, progress so far) without starting it — so I commit the room to the right thing. |
| **FIND-R** Return to what we've played | FIND.9 | Get back to something played recently on any screen in the house — so I don't have to search for it again. |
| | FIND.10 | See what's unfinished and what comes next in a series, and mark things watched or unwatched — so I can carry on without remembering where I was. |
| | FIND.11 | See what played earlier on a screen, item by item — so I can find the song I liked. |
| | FIND.12 | Keep favourites — so the things we put on every day are one tap away. |
| | FIND.13 | Remove something from the household list — so it stops showing up in recent, carry on, and suggestions. |

#### PLAY — Decide what plays

| Group | ID | Job |
|---|---|---|
| **PLAY-S** Start something | PLAY.1 | Play this item now at the aim, keeping the rest of the queue — so it starts immediately without losing what was lined up. |
| | PLAY.2 | Play a whole show, album, or playlist in order, replacing the queue — so I don't have to pick each part. |
| | PLAY.3 | Shuffle a whole collection — so it plays in a fresh order. |
| | PLAY.4 | Continue from where it was left off, with starting over one step away — so I keep my place without being forced into it. |
| | PLAY.8 | Show something briefly on a screen, then return to what was on — so a doorbell camera or quick clip doesn't end the programme. |
| | PLAY.9 | Add music behind a photo slideshow — so pictures have a soundtrack. |
| **PLAY-L** Line things up | PLAY.5 | Play this right after the current thing — so it's next without interrupting. |
| | PLAY.6 | Add this to the end of the queue — so it plays eventually without disturbing the order. |
| | PLAY.7 | Add a whole collection to the queue, next or at the end — so I can build long queues quickly. |
| | PLAY.10 | Set a screen's queue to "add only" while hosting — so other people's taps add rather than replace. |

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
| **STEER-H** Keep hold of what's playing | STEER.1 | Always see which playback I'm steering, reach it from anywhere (including the lock screen), keep hold of the screen I last sent to, and switch to another screen's — so control is one tap away and never ambiguous. |
| | STEER.2 | Watch video big, and shrink it back without interrupting — so I can watch properly and still use the app. |
| **STEER-T** Control playback | STEER.3 | Pause, resume, skip forward or back — so I can react to the room. |
| | STEER.4 | Move to a position: scrub, jump back or forward a few seconds, go live — so I can catch what I missed. |
| | STEER.5 | Change volume and playback speed — so it suits the room and the listener. |
| | STEER.6 | Stop, knowing what stopping leaves behind, and turn the screen off where it can — so I end playback without losing the queue by accident. |
| | STEER.10 | Set a sleep timer — so playback stops when I fall asleep. |
| | STEER.11 | Pause or stop every screen at once — so I can quiet the house in one step. |
| | STEER.12 | Turn subtitles on and choose the audio language — so everyone can follow. |
| **STEER-Q** Shape the queue | STEER.7 | See what's playing and what's coming up, for any playback, even after it stops — so I always know what happens next. |
| | STEER.8 | Reorder, jump to, remove, or clear items in the queue — so the order is what I want. |
| | STEER.9 | Set repeat and shuffle for the queue — so it plays on the way I want without me. |
| | STEER.13 | Choose what happens when the queue ends, and whether the next episode starts on its own — so the house isn't suddenly silent and a series continues, or stops, on purpose. |

#### HOUSE — See the house

| Group | ID | Job |
|---|---|---|
| **HOUSE-O** Overview | HOUSE.1 | Glance at whether anything is playing anywhere, from wherever I am in the app — so I notice without going looking. |
| | HOUSE.2 | See what each screen is doing: title, progress, playing, paused, or off — so I know what is happening around the house at once. |
| | HOUSE.3 | Tell whether what I'm seeing is current — so I don't act on old news. |
| **HOUSE-K** Know the screens | HOUSE.4 | Recognise every screen, including phones and laptops, by a name people use — so I can tell them apart and pick the right one. |
| | HOUSE.5 | See whether a person or a routine started what's playing — so a TV that "turned itself on" makes sense. |
| | HOUSE.6 | Add, place, merge, and retire screens — so the house list is real and trustworthy. |

#### RELY — Rely on it

| Group | ID | Job |
|---|---|---|
| **RELY-C** Know my action worked | RELY.1 | Get the same kind of confirmation for the same kind of outcome, naming the item and the screen — so I never wonder whether a tap did anything. |
| | RELY.2 | See progress while a far screen gets ready (turning on, loading) — so waiting doesn't feel like failure. |
| | RELY.3 | Know that it actually started playing on the far screen, or might not have — so I can stop watching the phone. |
| | RELY.4 | Undo my last change to what's playing or lined up — so a slip costs nothing. |
| **RELY-R** Recover when it goes wrong | RELY.5 | Be told when playback fails or skips an item, wherever I am in the app — so silence never hides a problem. |
| | RELY.6 | Retry exactly the attempt that failed, or redirect it to another screen — so fixing it is one step. |
| **RELY-K** Keep my place | RELY.7 | Keep what's playing, its position, and its queue through a reload, a crash, or a network hiccup — so nothing is lost when something outside my control happens. |
| | RELY.8 | Start fresh when I choose, knowing exactly what will be cleared — so I can reset without surprises. |
| **RELY-O** Stay oriented | RELY.9 | Know where I am in the app and move between its main areas — so I never feel lost. |
| | RELY.10 | Go back one step predictably — so I can retrace my way out. |
| | RELY.14 | Get started on a new device: name it and learn where taps go — so first use isn't a guess. |
| **RELY-A** Use it comfortably | RELY.11 | Read and hear everything: large text, spoken announcements, status never shown by colour alone — so the app works for every eye and ear. |
| | RELY.12 | Reach the main controls one-handed — so a full hand doesn't stop me. |
| | RELY.13 | Read it in any light — so glare doesn't hide where things will play. |

#### AUTO — Let the house start things

| Group | ID | Job |
|---|---|---|
| **AUTO-T** Start from a trigger | AUTO.1 | When a button, tag, or routine fires, start the chosen content (item, queue, shuffled collection, with volume) on the chosen screen — so the house does the right thing with nobody touching a screen. |
| | AUTO.2 | Have repeated or overlapping triggers produce one predictable result, and let people in the room override it normally — so routines never pile up or fight the household. |
| **AUTO-O** Let the house know | AUTO.3 | Let every other screen and household display know what each screen is playing — so the house picture is complete, including browsers. |
| | AUTO.4 | See recent routine starts and whether they worked — so a routine that fails with nobody watching still gets noticed. |

**Totals:** 7 domains, 20 job groups, 69 jobs. RELY-A also applies as a check on every acceptance criterion in this document.

---

## 3. User stories by job group

Story IDs extend the job ID with a letter. Acceptance criteria (AC) are observable outcomes.

### FIND-S — Look for something I can name

**FIND.1a** As a **Seeker**, I want to start typing a title from anywhere in the app, so that I reach it without navigating first.
- From any part of the app, one obvious action (or starting to type, where there is a keyboard) opens search with the cursor ready.
- Results begin appearing while I type, each with a picture, title, and kind.
- The search looks and behaves the same on a phone, tablet, or laptop, and whatever I was doing before (including steering another screen).
- Closing search returns me to exactly where I was.
- After **Play**, **Add to queue**, or **Play on…**, search stays open with my words and narrowing, so I can keep going (R24).

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
- If nothing matches in the chosen kind, matches from all kinds appear under a divider ("Not in Audiobooks — from everything:"), with the kind in words on every row (R25).
- If a source didn't answer, I'm told that before any widening, so a failure never looks like "not there" (R25).
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
- Opening the app shows a small set of suggestions: favourites, what's unfinished, what has played on this screen at this time of day, and new additions (R15, R46).
- Suggestions follow the same tap rule as every other item: a collection opens, a playable item plays at the aim, and details are one step away (Q2).
- Suggestions never include what's already playing on any screen (R16).

### FIND-L — Understand before choosing

**FIND.8a** As a **Wanderer**, I want to see details about one item without starting it, so that I can decide with confidence.
- From any item, wherever it appears (search, browsing, suggestions, recent), I can open its details in one step.
- Details show picture, title, description, length, kind, and how far anyone has got.
- Details offer the same play and line-up actions as everywhere else, with the destination stated.
- Opening details never starts, stops, or changes playback.

**FIND.8b** As a **Seeker**, I want tapping a result to do the obvious thing while details stay one step away, so that speed and understanding don't compete.
- Tapping a playable item (episode, song, film) plays it at the aim; tapping a collection (show, season, album, playlist, artist, folder) opens it. Same everywhere (Q2).
- Collection results also carry an inline **Play** button, or **Continue S2E7** when one is under way, so "Put on Bluey" is one tap (R8).
- Cameras and single photos are the exception: a tap shows them on the device in hand, with **Show on…** as the second action (R10).
- A mis-tap costs nothing: the confirmation offers undo (`RELY.4`).
- A secondary action on every result opens its details.

### FIND-R — Return to what we've played

**FIND.9a** As a **Resumer**, I want recently played items from every screen, so that something played on the TV last night is still easy to find.
- Recent items include things played on any screen in the house, each marked with where it last played.
- A recent item offers the same actions as any other item (details, play, line up, send elsewhere).
- Tapping a recent item never replaces a queue without the same confirmation and undo as any other play.

**FIND.10a** As a **Resumer**, I want to see unfinished things and next episodes, so that I can carry on without searching.
- Unfinished items show where they stopped (for example, "34 min left", "Chapter 7").
- For a series, the next unwatched episode is offered.
- Anything playing on any screen right now is not offered as "carry on"; it shows instead as "Now on Living Room TV · Remote · Move here" (R16).
- Each screen keeps its own spot; when they differ, both are shown (R14).
- Something counts as unfinished only after 5 minutes or 5% has been watched (default), and as finished once the credits start (R41).
- Any item can be marked watched or unwatched (R41).
- Finished items drop off the list on their own.

**FIND.11a** As an **Ambient listener**, I want to see what played earlier on a screen, item by item, so that I can find the song I liked.
- Each screen's queue has a **Played earlier** list, newest first, with picture, title, and the time it played.
- Items from shuffled or "keep similar things playing" runs are included.
- Any item there offers the same actions as everywhere else, including adding it to favourites.

**FIND.12a** As an **Ambient listener**, I want to keep favourites, so that the things we put on every day are one tap away.
- Any item or collection can be added to or removed from favourites in one step, wherever it appears.
- Favourites appear first on the start page and among suggestions.
- Favourites are shared by the household (Q3); anyone can remove one.

**FIND.12b** As a **Child**, I want favourites shown as big pictures, so that I can find them without reading.
- Favourites show large pictures with the title underneath.
- Tapping one follows the same rule as everywhere: its **Play** button plays, the picture opens it (Q2, R8).

**FIND.13a** As a **Hand-Held Viewer**, I want to remove something from the household list, so that a late-night film doesn't show up on the children's tablet.
- Any item in recent, carry on, or suggestions can be removed from the household list in one step.
- A removed item stops appearing in suggestions on every screen.
- Removal can be undone for 10 seconds (default).

---

### PLAY-S — Start something

**PLAY.1a** As a **Seeker**, I want "play now" to play at my aim, whichever control I use, so that the same word always does the same thing.
- "Play now" on a search result, a browsed item, an item's details, a suggestion, or a recent item all play at the aim shown on screen.
- The item starts now on that screen; whatever was queued after the old item stays queued (R1).
- A confirmation names the item and the screen (see `RELY.1`).
- If the aim is busy with someone else's playback, the aim label says so before I tap (`PLACE.5`); the tap itself never stops to ask (R2).
- Tapping the same item again while it is still starting doesn't start it twice; the item reads "Starting on Living Room TV…" (R34).

**PLAY.1b** As a **Hand-Held Viewer**, I want "play now" to start here when my aim is this device, so that I stay in control of what's in my hands.
- With the aim on this device, every "play now" starts on this device; no other screen changes.
- Playback starts without leaving the part of the app I'm in; a compact handle appears (see `STEER.1`).

**PLAY.2a** As a **Wanderer**, I want to play a whole show or album in order, so that I don't pick each part.
- A whole-collection "play" is available wherever the collection appears (result, browse, details).
- Playback starts at the first part (or the first unfinished part; see `PLAY.4`) and the queue lists the rest in order.
- Playing a collection replaces that screen's queue, in order with shuffle off. The confirmation names the collection, the number of items, and the screen, and offers undo (R1, R26).

**PLAY.3a** As a **Queue Builder**, I want to shuffle a whole collection in one step, so that it plays in a fresh order.
- "Shuffle" is offered beside "play" on every collection, wherever it appears.
- The queue shows the shuffled order and shuffle reads as on.
- Starting a collection with **Shuffle** turns shuffle on; starting one with **Play** turns it off (R26).

**PLAY.4a** As a **Resumer**, I want to choose between continuing and starting over, so that I get the position I meant.
- When an item has a saved spot, playing it continues from there; the confirmation offers **Start over** (R9).
- Each screen keeps its own spot. When they differ, I choose: "1 h 20 m on Living Room TV · 12 m on Kid's tablet" (R14).
- When there's no saved spot, it simply starts.

**PLAY.8a** As a **Bystander**, I want a doorbell camera or clip shown on the TV to go back to my programme afterwards, so that an interruption doesn't end what we were watching.
- **Show briefly** puts the camera or clip over what's playing on that screen.
- Closing it, or its time running out, returns the previous programme at its spot, with its queue.
- The note on the screen says what interrupted and where it came from.

**PLAY.8b** As a **Routine Setter**, I want a doorbell routine to show the camera briefly and then return, so that visitors don't end the film.
- A routine can choose "show briefly, then return" for any screen.
- Cameras started by routines use it unless the routine says otherwise.

**PLAY.9a** As a **Host**, I want music playing behind a photo slideshow, so that a birthday slideshow on the TV has a soundtrack.
- While a slideshow plays, **Add music behind** lets me choose a song, album, or playlist.
- Photos and music are steered separately: skipping a photo doesn't skip a song.
- Stopping the slideshow asks whether to keep the music playing.

### PLAY-L — Line things up

**PLAY.5a** As a **Queue Builder**, I want one clear "play next" action, so that I know exactly where the item goes.
- There is one "play next" verb, available on every item wherever it appears.
- The item appears immediately after what's playing now; if I add several, they play in the order I added them (Q4).
- The confirmation states the position and screen, for example "Next · 3rd in line on Kitchen speaker"; pressing and holding **Play next** offers "at the very front" (R27).

**PLAY.6a** As a **Seeker**, I want to add something to the end without interrupting, so that the current playback isn't disturbed.
- "Add to queue" is available on every item wherever it appears and uses the aim.
- What's playing continues without a pause or skip.
- The confirmation names the item, its position ("7th"), and the screen.

**PLAY.7a** As a **Queue Builder**, I want to add a whole album or season to the queue, next or at the end, so that I can build long queues quickly.
- Whole-collection "play next" and "add to queue" are available wherever a collection appears.
- The confirmation states how many items were added and where.
- The added items keep their natural order.

**PLAY.10a** As a **Host**, I want a screen's queue set to "add only" during a party, so that guests' taps add songs instead of replacing mine.
- Turning **Add only** on or off for a screen's queue takes one step.
- While it's on, **Play** from any other device adds to the queue and says "Added · 5th in line" instead of replacing.
- The screen's row in the house view shows that add-only is on.
- This protects a host's queue; it is not a limit on children (Q11), and anyone can turn it off.

---

### PLACE-A — Aim at a screen

**PLACE.1a** As a **Big-Screen Sender**, I want the aim shown next to every play action, so that I know where a tap will go before I tap.
- Everywhere a play or line-up action appears, the aim is visible on the same screen, on every device size.
- The aim uses the screen's name and room ("Living Room TV"), or "This device (Dad's phone)", or "3 screens" (R49).
- What the aim says is always what happens. No control ignores it.
- When I'm steering another screen, the aim is still shown as its own thing and does not change unless I change it (see Tension T2).

**PLACE.2a** As a **Big-Screen Sender**, I want to aim at a TV for the evening, so that every play goes there without extra steps.
- I can change the aim in one step from wherever the aim is shown.
- The chosen aim persists as I move around the app and after a reload.
- After 2 hours of no use (default), the aim returns to "this device" on its own, so a phone is never left aimed at a TV for days (Q1).
- That clock doesn't run while the aimed screen is playing something this device sent or is steering (R4).
- Opening the app after that much idle starts on "this device", even though a reload otherwise restores the aim (R7).
- Every play and line-up action then uses it (see `PLAY.1a`).

**PLACE.2b** As a **Hand-Held Viewer**, I want to aim back at this device in one step, on any device, so that I'm never stuck sending to a TV.
- "This device" is always one of the choices, on phone, tablet, and laptop alike.
- Choosing it immediately updates the aim everywhere it is shown.
- Starting fresh (`RELY.8`) also offers to return the aim to this device.

**PLACE.3a** As a **Big-Screen Sender**, I want to send a single item to a different screen without changing my aim, so that one-off exceptions are painless.
- Every item, wherever it appears, offers "play on…" (and "add to queue on…").
- Choosing a screen sends only that item there; the aim reads the same afterwards.
- The confirmation names the item and the screen it went to.

**PLACE.3b** As a **House Watch**, I want to add a single item to another screen's queue, so that the kids' room gets one more episode without me walking in. *(Moved from PLAY.6b, R48.)*
- With another screen as the aim, or via **Add to queue on…** on the item, the item joins that screen's queue.
- That screen's queue visibly includes the new item when I look.

**PLACE.4a** As a **Big-Screen Sender**, I want to play on several screens at once, so that the whole ground floor hears the same thing.
- When choosing a screen, I can choose more than one, with the choice clearly labelled as "several screens".
- The aim then reads, for example, "Kitchen + Living Room".
- Progress and confirmation are shown per screen, so one failing doesn't hide the others succeeding.
- The screens start at about the same time, then each is steered on its own; they may drift apart (Q8).
- Either screen's Remote offers **Line up with Kitchen** to bring them back together (R29).
- Choosing screens in the same or neighbouring rooms warns that drift may be audible (R29).
- **Add to queue** with several screens aimed adds to each, and the confirmation says so (R29).

**PLACE.5a** As a **Big-Screen Sender**, I want to see what each screen is doing while I choose, so that I don't interrupt someone.
- Each choice shows the screen's name, room, and whether it is playing (with title and time left), paused, idle, or off.
- Screens that haven't reported in the last 2 minutes (default) are marked as uncertain.
- Choosing a screen that is playing someone else's content warns me what will be replaced before it happens, and the aim label keeps showing that it's busy, so no later tap needs to ask (R2).
- "Someone else's playback" means something started from a different device, or by a routine, since that screen was last idle (R3).

**PLACE.6a** As a **Room Hopper**, I want to decide, when I send, whether this device stops or keeps playing, so that I get a hand-off or a second room on purpose.
- Whenever this device is playing and the aim is another screen, the aim label shows what will happen here ("move it" or "keep playing here too"), and I can change it there before tapping, on every device size (R2).
- A one-off **Play on…** or **Move to…** asks at that moment, pre-set to my usual choice.
- My usual choice is remembered and pre-selected, and visible before I confirm.
- Afterwards, this device does exactly what the choice said.

### PLACE-M — Move what's playing

**PLACE.7a** As a **Room Hopper**, I want to bring what's playing on the TV to the device in hand, so that I can carry on as I leave the room.
- Wherever I can see another screen's playback (the house overview or its controls), "move to this device" is offered.
- This device starts the same item at the same moment with the same queue; the other screen stops.
- A confirmation says it moved, and from where.
- If it can't move, I'm told why and the other screen keeps playing.
- Video, audio, and photo slideshows move at the same spot; a live channel or camera simply starts fresh on the new screen (Q5).

**PLACE.8a** As a **Room Hopper**, I want to send what's playing here to a TV at the same moment, so that I switch to the big screen without starting over.
- From the handle on my own playback, "move to…" is offered, wherever I am in the app.
- The chosen screen starts at the same moment with the same queue.
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
- Tapping it opens full controls and the queue.
- When full controls are open, the compact handle doesn't duplicate them.
- The handle also covers the screen I most recently sent to or steered, so pausing the TV when the phone rings is one tap (R21).
- The same controls are available from the lock screen and notifications (R21).

**STEER.1b** As a **House Watch**, I want to steer another screen with the same controls I use for this device, so that I don't learn two ways.
- Opening another screen's playback shows the same controls, in the same layout, with that screen's name clearly at the top.
- Controls the screen can't support are shown as unavailable with a short reason, not missing.
- It is always obvious which screen I am steering, and I can switch to another in one step.
- Leaving the controls of another screen never changes my aim.
- When I pause, stop, replace, or move another screen's playback, that screen shows a brief note saying where it came from, for example "Paused from Dad's phone", with **Put it back** (Q7, R30).
- Volume changes don't produce notes, and repeated notes are grouped. A screen that can't show a note, such as a speaker, records it on its row in the house view (R30).
- While controlling another screen, **Add to this queue** opens the one search pointed at that screen for that add only; my aim doesn't change (R23).

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
- Skip forward and back are available for any queue.
- After a press, the control reflects the change within 2 seconds, or tells me it hasn't happened yet (R46).
- If the screen can't be reached, the press reads "not sent" and is never carried out later (R35).

**STEER.4a** As a **Hand-Held Viewer**, I want to scrub and jump a few seconds back or forward, so that I can catch what I missed.
- A position bar can be dragged; the time is shown while dragging.
- Jump back and forward buttons are present for every playback, local or on another screen.
- Live content shows that it's live and offers "go to live" instead of a position.

**STEER.5a** As a **House Watch**, I want to change volume and speed for whatever I'm steering, so that it suits the listener.
- Volume can be changed with large tap targets (steps up and down), not only by dragging, and the level is shown.
- Speed can be changed for spoken word and video wherever the screen supports it.
- Changes take effect on the screen being steered, not on this device.

**STEER.6a** As a **Fixer**, I want to stop playback and know what stopping leaves, so that I don't lose a queue by accident.
- There is one "stop" control, meaning the same thing everywhere.
- After stopping, I'm told what remains ("Queue kept: 8 items") and can reopen it.
- Emptying the queue is a separate, clearly named action (`STEER.8`).
- Where the screen supports it, stop also offers **and turn the screen off** (R42).

**STEER.10a** As a **Resumer**, I want a sleep timer, so that a bedtime audiobook stops once I'm asleep and I can find where I dropped off.
- I can set it to stop after a number of minutes, or at the end of this chapter or episode.
- Playback fades out rather than cutting off, and the time left shows on the handle.
- Continue later offers both where it stopped and where the timer was set.

**STEER.11a** As a **House Watch**, I want to pause or stop every screen at once, so that I can quiet the house in one step.
- **Pause all** and **Stop all** are on the house view and the handle.
- After pausing all, **Resume all** brings back exactly the screens that were playing.
- Screens that couldn't be reached are listed as not paused.

**STEER.12a** As a **House Watch**, I want to turn subtitles on and choose the audio language for whatever I'm steering, so that visiting grandparents can follow the film.
- Subtitles and audio language are available for this device and for any screen through its Remote.
- Only the languages the item actually has are offered.
- The choice carries on to the next episode of the same show.

### STEER-Q — Shape the queue

**STEER.7a** As a **Queue Builder**, I want to open the queue for any playback from anywhere, even after it stops, so that I always know what's next.
- The queue is reachable in one step from the handle on my playback and from any screen's controls.
- It's still reachable after stopping, until I clear it or start fresh.
- It shows what's playing now, what's next (including items placed "next"), and a count.
- Photos have a queue like video and audio; a live channel or camera is a single thing with no queue or position (Q5).
- Each queue also shows what **played earlier** (`FIND.11`).

**STEER.8a** As a **Queue Builder**, I want to reorder, jump to, remove, and clear queue items, so that the order is exactly right.
- I can move an item up or down, or drag it, and the new order shows immediately.
- Tapping an item plays it now.
- Removing one item or clearing all can be undone for 10 seconds (default; see `RELY.4`).
- These work identically for this device and another screen.

**STEER.9a** As a **Queue Builder**, I want to set repeat and shuffle once, in one place, so that it plays on the way I want.
- Repeat (off, all, one) and shuffle each appear once, alongside the queue, and show whether they are on.
- Changing them doesn't interrupt what's playing.
- They behave the same for any screen.
- Shuffle only reorders what's already queued; items placed "next" are never shuffled, and turning shuffle off restores the original order (R26).

**STEER.13a** As an **Ambient listener**, I want to choose what happens when the queue ends, so that the house doesn't go silent mid-dinner.
- The end of the queue offers: stop, repeat, or keep similar things playing.
- The current choice is shown at the bottom of the queue.
- Items added by "keep similar things playing" are marked as added automatically.

**STEER.13b** As a **Resumer**, I want the next episode to start on its own after a countdown, with "stop after this one", so that a series carries on without fetching the phone, and a parent can end it.
- At the end of an episode, the next starts after a visible countdown that can be cancelled.
- **Stop after this one** can be set during an episode, on this device or from a Remote.
- Next-episode behaviour lives here; carry on only lists what's next (`FIND.10`).

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
- Each row has **Pause**, **Stop**, and **Move here** directly on it (R22).
- A row shows that screen's current start progress or last failure to everyone, not only to the device that sent it (R36).
- The overview offers **Pause all** and **Stop all** (`STEER.11`).

**HOUSE.2b** As a **Room Hopper**, I want to see this device alongside every other screen in the overview, so that the house picture is whole.
- This device appears in the overview, marked as "this device".
- What it shows matches what other people see for it from their devices (checked with two devices side by side).

**HOUSE.3a** As a **House Watch**, I want to know when information might be out of date, so that I don't act on old news.
- A screen that hasn't reported in the last 2 minutes (default) is marked with when it was last heard from.
- If this device loses touch with the house, the whole overview says so, and recovers on its own.
- Controls on an uncertain screen say that the result may not be confirmed.

### HOUSE-K — Know the screens

**HOUSE.4a** As a **Routine Setter**, I want every screen, including browsers, to have a human name, so that people and routines can pick the right one.
- Every screen is listed under a name like "Kitchen tablet" or "Dad's laptop", never a code.
- Anyone can name or rename a device from within the app; TVs and kiosks come already named (Q10).
- Names are unique. After a rename, the house view shows "Poo (was Kitchen tablet)" for a week (default), and renaming a screen a routine uses says so first (R31).
- The name stays the same across reloads and appears everywhere the screen is mentioned.

**HOUSE.5a** As a **House Watch**, I want to see whether a person or a routine started something, so that unexpected playback makes sense.
- A screen's playback shows how it started, for example "Started by kitchen button, 7:02".
- The same note appears in the screen's controls.

**HOUSE.6a** As a **Setup person**, I want to add, place, merge, and retire screens, so that the house list stays trustworthy.
- I can add a screen and give it a name and a room.
- When a device reappears as a duplicate, I can merge it with its earlier self.
- Before retiring an old screen, I'm shown which routines point at it.
- Screens silent for more than 30 days (default) fold into a "not seen lately" section.

---

### RELY-C — Know my action worked

**RELY.1a** As a **Seeker**, I want every play, add, and send to confirm in the same way, so that I never wonder whether a tap worked.
- Every action that changes what's playing or lined up gives a short confirmation naming the item and the screen.
- The same outcome confirms the same way, whichever control started it, on every device size.
- When the result is already obvious on this device (it visibly starts playing here), the confirmation is brief and unobtrusive.
- Confirmations don't pile up; a newer one replaces an older one of the same kind.
- "The same outcome" includes where it happened: playing here confirms quietly, while playing on another screen confirms with that screen's name and progress (T8).

**RELY.2a** As a **Big-Screen Sender**, I want to see progress while a TV turns on and loads, so that waiting doesn't feel like failure.
- While a far screen gets ready, I see its steps in plain words ("Turning on", "Loading").
- Progress is visible wherever I go in the app until the outcome is known.
- The wording fits the screen type (it doesn't say "TV" for a speaker).

**RELY.3a** As a **Big-Screen Sender**, I want to know it actually started, so that I can put the phone down.
- When playback is confirmed, I see "Playing on Living Room TV" with a way to steer it.
- If it can't be confirmed, I'm told it may not have started, with options to check (steer it) or try again.
- An unconfirmed outcome stays visible until I dismiss it.
- "May not have started" notices for the same screen replace each other, and clear once that screen reports playing (R37).

**RELY.4a** As a **Queue Builder**, I want to undo my last change, so that a slip costs nothing.
- After replacing what's playing, removing, or clearing, an undo is offered for 10 seconds (default).
- Undo restores the previous item, position, and queue on that screen.
- Truly irreversible actions (starting fresh) ask first instead of offering undo.
- Undo (**Put it back**) is also available from the affected screen's Remote on any device, not only on the device that made the change (R13).

**RELY.4b** As a **Bystander**, I want to put back what was on from the screen that was changed, so that I don't need the phone that changed it.
- The note on the changed screen offers **Put it back** (Q7, R30).
- Any device's Remote for that screen offers the same (R13).
- Putting it back restores the item, its spot, and its queue.

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
- After a reload or crash, what was playing, its position, its queue, and repeat and shuffle are as they were, with playback paused rather than suddenly playing aloud (R38).
- My aim is restored too, unless the idle time has passed (R7).
- Every screen keeps its spot and queue through a power cut (R38).
- A brief network hiccup doesn't reload the app or interrupt what I'm doing; I see a quiet "reconnecting" note if it lasts.
- The part of the app I was in is restored.

**RELY.8a** As a **Fixer**, I want to start fresh knowing what will be cleared, so that I get a clean slate without surprises.
- "Start fresh" is in this device's settings, reachable in one step from anywhere (R46).
- It lists exactly what will be cleared (what's playing, queue, position, aim) and lets me keep some of it.
- It asks for confirmation, then everything reads as new.

### RELY-O — Stay oriented

**RELY.9a** As a **Wanderer**, I want to know where I am and move between the main areas, so that I never feel lost.
- The current area is always highlighted, including when I'm in the queue or another screen's controls.
- Choosing the area I'm already in takes me to its top, without adding extra steps to going back.

**RELY.10a** As a **Wanderer**, I want "back" to retrace my steps, so that I can find my way out.
- Back, whether the device's own back or an on-screen one, goes one step to where I actually came from.
- Any on-screen back is labelled with where it goes, and goes there.
- Closing a pop-up counts as one back.

**RELY.14a** As a **Setup person**, I want a first-use moment on a new device, so that it gets a name and whoever holds it learns where taps go.
- The first time the app opens on a device, it asks for a name, with a sensible default and a way to skip.
- It explains the "Playing to:" aim label once.
- A household with nothing played yet sees a way into browsing by kind instead of an empty page.

### RELY-A — Use it comfortably

These jobs are also a check on every acceptance criterion above (R44).

**RELY.11a** As a **Seeker** with low vision, I want large text, spoken announcements, and status that isn't shown by colour alone, so that I can use the app without squinting.
- Text follows the device's large-text setting without anything being cut off.
- Every confirmation, warning, and change of status is announced by screen readers.
- Playing, paused, and out-of-date are shown with words or shapes as well as colour.

**RELY.12a** As a **Hand-Held Viewer** holding a baby, I want the main controls within thumb reach, so that I can use the app one-handed.
- The aim, play/pause, and search can be reached with one thumb on a phone.
- No essential action needs two hands.

**RELY.13a** As a **Big-Screen Sender** on a sunny patio, I want the app readable in glare, so that I can still see where things will play.
- Text and controls keep enough contrast to read outdoors.
- The aim label and confirmations stay legible at arm's length.

---

### AUTO-T — Start from a trigger

**AUTO.1a** As a **Routine Setter**, I want a button, tag, or routine to start content on a named screen, so that the house does the right thing with nobody at a screen.
- When the trigger fires, the named screen starts the chosen item, queue, or shuffled collection, with the chosen volume.
- It starts within the same few seconds a person's send would.
- Progress and failures are reported like any other send, visible to anyone looking at that screen in the overview (see `HOUSE.5`), and recorded in routine history (`AUTO.4`).

**AUTO.1b** As a **Routine Setter**, I want a routine to be able to start playback on a device left open on the wall, so that the kitchen tablet can play the morning programme. *(Persona corrected, R48.)*
- Any named device left open in the app can be a target for routines (Q10).
- Routines follow the screen itself, so renaming it doesn't break them (R31).
- Playback started this way appears on that device as if someone had started it there.

**AUTO.2a** As a **Routine Setter**, I want repeated or overlapping triggers to give one predictable result, so that routines don't pile up.
- Firing the same trigger twice within 10 seconds (default) doesn't start it twice or add duplicates to the queue.
- Reloading a device that a routine started doesn't restart the routine's content from the beginning.
- A person's action on that screen after a routine always takes effect; the routine doesn't fight it.

### AUTO-O — Let the house know

**AUTO.3a** As a **House Watch**, I want every screen, including browsers, to report what it's playing to the rest of the house, so that the overview and household displays are complete.
- Anything playing on any device in the app appears in the overview and on other household displays.
- When a device stops or is closed, it shows as stopped soon after, not as still playing.
- A person using the app on a device can see that it is visible to the house.

**AUTO.4a** As a **Routine Setter**, I want a record of recent routine starts and how they went, so that a failed 7:00 routine doesn't go unnoticed.
- A list shows each routine start: when, which screen, what, and whether it played.
- A failure is marked plainly, with the reason ("Kitchen tablet was asleep").
- A routine pointed at a screen that isn't on or reachable is flagged ahead of time.

**Totals:** 82 user stories across 69 jobs.

---

## 4. Mappings

### 4.1 Persona × job-group matrix

**P** Primary · **S** Secondary · **R** Rare · **N** Never

| Group | P1 Wanderer | P2 Seeker | P3 Sender | P4 House Watch | P5 Hand-Held | P6 Queue Builder | P7 Room Hopper | P8 Routine Setter | P9 Resumer | P10 Fixer | P11 Bystander | P12 Ambient | P13 Host | P14 Setup | P15 Child |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIND-S Look for something I can name | S | **P** | S | S | S | **P** | R | R | R | R | N | R | **P** | R | R |
| FIND-E Explore without a title | **P** | S | S | R | S | **P** | N | R | S | N | N | S | S | N | **P** |
| FIND-L Understand before choosing | **P** | S | R | N | S | S | N | R | S | N | N | R | R | N | N |
| FIND-R Return to what we've played | S | S | R | R | S | S | R | N | **P** | R | R | **P** | S | N | **P** |
| PLAY-S Start something | **P** | **P** | **P** | S | **P** | S | R | S | **P** | R | R | **P** | S | R | **P** |
| PLAY-L Line things up | R | S | S | S | S | **P** | N | S | S | N | N | S | **P** | N | R |
| PLACE-A Aim at a screen | S | **P** | **P** | S | **P** | S | **P** | S | S | S | N | S | **P** | S | R |
| PLACE-M Move what's playing | R | R | S | S | R | R | **P** | N | S | S | R | S | R | R | N |
| STEER-H Keep hold of what's playing | S | S | S | **P** | **P** | S | **P** | R | S | **P** | S | S | S | R | S |
| STEER-T Control playback | R | R | S | **P** | **P** | S | S | R | S | **P** | S | **P** | S | R | S |
| STEER-Q Shape the queue | R | R | S | S | S | **P** | S | R | S | S | S | **P** | **P** | N | R |
| HOUSE-O Overview | R | R | S | **P** | R | S | **P** | S | S | **P** | R | S | S | S | N |
| HOUSE-K Know the screens | R | R | S | **P** | R | R | S | **P** | R | S | S | R | R | **P** | N |
| RELY-C Know my action worked | S | **P** | **P** | S | S | **P** | **P** | **P** | S | **P** | **P** | S | **P** | S | S |
| RELY-R Recover when it goes wrong | R | S | **P** | S | S | S | S | **P** | S | **P** | S | S | S | S | R |
| RELY-K Keep my place | R | R | R | R | **P** | S | S | S | **P** | **P** | S | S | S | R | R |
| RELY-O Stay oriented | **P** | S | S | S | S | S | R | N | R | S | N | R | R | S | S |
| RELY-A Use it comfortably | S | S | S | S | S | S | S | S | S | S | S | S | S | S | S |
| AUTO-T Start from a trigger | N | N | N | R | R | N | N | **P** | N | R | S | S | N | **P** | N |
| AUTO-O Let the house know | N | N | R | S | N | N | R | **P** | N | R | S | R | N | **P** | N |

Reading the matrix:
- **PLACE-A is Primary for 5 personas (P2, P3, P5, P7, P13) and at least Rare for all but the Bystander.** Knowing where things will play is a single, always-visible concern, not a feature of some buttons.
- **RELY-C is Primary for 8 personas.** Confirmation is not polish; it is the most widely shared need in the model.
- **STEER-H is Primary for 4 very different personas** (P4, P5, P7, P10). One way of holding and steering any playback serves all of them.
- **RELY-A is Secondary for everyone.** It is a lens applied to every path, not a path of its own.
- Seven cells were corrected after the review (R47): P2, P5, and P7 PLACE-A to Primary; P10 RELY-K to Primary; P4 PLAY-L and P6 HOUSE-O to Secondary; P1 HOUSE-K to Rare.

### 4.2 Persona → larger job → jobs and stories, in path order

| Persona | Larger job | Path (job / story IDs, in order) |
|---|---|---|
| **P1 Wanderer** | WA-1 Find something that suits the moment | FIND.7a → FIND.5a → FIND.6a → RELY.10a |
| | WA-2 Check it's right | FIND.8a → FIND.8b |
| | WA-3 Get it playing where everyone is | PLACE.1a → PLAY.1a or PLAY.2a → RELY.1a → RELY.2a → RELY.3a |
| **P2 Seeker** | SK-1 Name → playing, fast | FIND.1a → FIND.3a → FIND.8b → PLACE.1a → PLACE.5a → PLAY.1a → PLAY.4a → RELY.1a |
| | SK-2 Narrow an ambiguous name | FIND.1a → FIND.2a → FIND.4a → FIND.8b |
| | SK-3 Queue it instead | FIND.1a → PLACE.1a → PLAY.5a or PLAY.6a → RELY.1a → STEER.7a |
| **P3 Big-Screen Sender** | BS-1 Aim at a TV for the evening | PLACE.5a → PLACE.2a → PLACE.1a → FIND.1a → PLAY.1a → RELY.2a → RELY.3a |
| | BS-2 Send one thing elsewhere | FIND.1b → PLACE.3a → PLACE.5a → RELY.1a |
| | BS-3 Know it started; fix it if not | RELY.2a → RELY.3a → STEER.1c → RELY.5a → RELY.6a |
| | BS-4 Aim back at the phone | PLACE.1a → PLACE.2b |
| **P4 House Watch** | HW-1 Glance at the house | HOUSE.1a |
| | HW-2 See each screen, trust it's current | HOUSE.2a → HOUSE.3a → HOUSE.4a → HOUSE.5a |
| | HW-3 Steer or change a screen from afar | HOUSE.2a → STEER.1b → STEER.3a → STEER.5a → STEER.6a → PLACE.3b → RELY.1a |
| **P5 Hand-Held Viewer** | HH-1 Play on the device in hand | PLACE.1a → PLACE.2b → PLAY.1b → RELY.1a |
| | HH-2 Keep control while doing other things | STEER.1a → STEER.3a → STEER.7a → RELY.5a |
| | HH-3 Watch big, steer precisely | STEER.2a → STEER.4a → STEER.5a → RELY.7a |
| **P6 Queue Builder** | LB-1 Build a queue without interrupting | FIND.1a → FIND.6a → PLACE.1a → PLAY.5a → PLAY.6a → PLAY.7a → RELY.1a |
| | LB-2 Arrange it | STEER.7a → STEER.8a → STEER.9a → RELY.4a |
| | LB-3 Build another screen's queue | HOUSE.2a → STEER.1b (Add to this queue) → PLACE.3b → PLAY.7a → STEER.7a |
| **P7 Room Hopper** | RH-1 TV → device in hand | HOUSE.2a → STEER.1b → PLACE.7a → RELY.1a |
| | RH-2 Device in hand → TV | STEER.1a → PLACE.8a → PLACE.5a → PLACE.6a → RELY.2a → RELY.3a |
| | RH-3 Between two other screens | HOUSE.2a → STEER.1b → PLACE.9a → HOUSE.2b |
| **P8 Routine Setter** | RS-1 Trigger starts content on a screen | HOUSE.4a → AUTO.1a → AUTO.1b → AUTO.2a |
| | RS-2 Triggered starts behave like a person's | AUTO.3a → HOUSE.2a → HOUSE.5a → STEER.1b → RELY.2a → RELY.5a |
| | RS-3 Stable, human screen names | HOUSE.4a |
| **P9 Resumer** | RE-1 Find the unfinished thing | FIND.10a → FIND.9a |
| | RE-2 Continue or start over, on the screen at hand | PLACE.1a → PLAY.4a → RELY.7a |
| | RE-3 Go on to the next part | FIND.10a → STEER.13b |
| **P10 Fixer** | FX-1 Find out what went wrong | RELY.5a → HOUSE.2a → RELY.2a → HOUSE.3a |
| | FX-2 Retry or redirect that attempt | RELY.6a → PLACE.3a → RELY.3a |
| | FX-3 Stop it, or undo what I did | HOUSE.2a → STEER.1b → STEER.6a → STEER.7a → RELY.4a |
| | FX-4 Back to a clean start | RELY.8a → PLACE.2b |
| **P11 Bystander** | BY-1 Understand what changed | STEER.1b → HOUSE.5a |
| | BY-2 Put it back | RELY.4b → RELY.4a |
| | BY-3 See what's on and next | STEER.7a |
| **P12 Ambient listener** | AL-1 Start the usual background | FIND.12a → PLACE.1a → PLAY.2a |
| | AL-2 Keep it going | STEER.13a |
| | AL-3 What was that song? | FIND.11a → FIND.12a |
| | AL-4 Quiet everything | STEER.11a |
| **P13 Host** | HO-1 Set up and protect the music | FIND.1a → PLAY.7a → STEER.8a → PLAY.10a |
| | HO-2 Let guests add | FIND.1a → PLAY.10a → PLAY.5a → RELY.1a |
| | HO-3 Adjust from the table | STEER.1a → STEER.3a → STEER.5a |
| **P14 Setup person** | SU-1 Add or replace a screen | HOUSE.6a → HOUSE.4a → AUTO.4a |
| | SU-2 Keep the list clean | HOUSE.6a |
| | SU-3 Check routines | AUTO.4a → HOUSE.3a |
| **P15 Child** | CH-1 Find a favourite | FIND.12b → FIND.8b |
| | CH-2 Start it, even after several taps | PLAY.1a |
| | CH-3 Keep watching | STEER.13b |

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
| PLAY.6 | C2, G5 | A single item added to any screen's queue. |
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
| STEER.7 | C5, G3, K3 (part) | Seeing the queue, reachable after stopping. |
| STEER.8 | C5, G3 | Editing the queue. |
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
- **C4** Shuffle → PLAY.3 (start a collection shuffled) and STEER.9 (the shuffle setting of a running queue). One is a way to start, the other a way to steer.
- **G1** Control a device → STEER.1 (which playback), STEER.3 (transport), STEER.6 (stop).
- **K3** Get to the queue → STEER.1 and STEER.7.
- **J1** Start from an automation → AUTO.1 (the start) and AUTO.2 (predictable when repeated or overridden).

**Merged**
- **B4 + G1**, **B5 + G2**, **C5 + G3**, **B7 + G1 stop**: this device and other screens share one set of steering jobs. The audit's division by *which screen* is a mechanism, not a need.
- **C6 + the C4 toggle** → STEER.9: repeat and shuffle live once.
- **B3 + E4 + K3** → STEER.1: "hold on to what's playing and reach its controls" was spread across three routes.
- **I1 + I3** → RELY.7: to a person, a reload and a network hiccup are the same worry.
- **C1**: "Play Next" and "Up Next" become one verb.

**Dissolved (no standalone ideal job)**
- **G4** Put something on a specific device → FIND.1 + PLAY.1 + PLACE.3. Four routes existed because "where" was welded to "what". With PLACE owning "where", this is not a separate job.
- **G5** Add to a device's queue → PLAY.6 / PLAY.7 at a chosen screen. Same reasoning.
- **K3** as a navigation job: reaching the queue is a property of STEER, not a destination to navigate to.

**Moved between concerns**
- **F4** from house awareness to PLACE.5, because it only matters while choosing.
- **J3** from automations to HOUSE.4, because people choosing a screen need names as much as routines do.

**Needs the current app does not serve at all**
- FIND.7 Suggestions for the moment
- PLACE.9 Move playback between two other screens
- HOUSE.5 Who or what started it
- RELY.4 Undo
- Partly new: FIND.10 (next episode), PLAY.4 (explicit continue or start over), RELY.1 (uniform confirmation), AUTO.2 (override and repeat-safety)

**Jobs added after the adversarial review** (no audit counterpart): FIND.11 played earlier · FIND.12 favourites · FIND.13 remove from the household list · PLAY.8 show briefly, then return · PLAY.9 music behind a slideshow · PLAY.10 add-only queue · STEER.10 sleep timer · STEER.11 pause or stop all · STEER.12 subtitles and audio language · STEER.13 queue end and next episode · HOUSE.6 tidy the screen list · AUTO.4 routine history · RELY.11–13 comfortable use · RELY.14 first use on a new device.

### 4.4 Tensions and the principles that resolve them

| # | Tension | Who pulls which way | Principle |
|---|---|---|---|
| T1 | **Where a plain "play" goes** | Big-Screen Sender wants taps to go to the TV by default. Hand-Held Viewer wants them to stay here. | **One aim, owned by the device in hand, always visible, always one step from "this device".** Neither default is imposed on the house: each device carries its own aim, a device new to the app starts aimed at itself, the aim returns to itself after 2 hours of no use unless the aimed screen is still playing what this device sent (Q1, R4, R7), and every play action shows the aim beside it (PLACE.1, PLACE.2). Sending elsewhere once never needs the aim changed (PLACE.3). |
| T2 | **Does steering a screen also aim at it?** | House Watch in a TV's controls expects a search result to go to that TV. Seeker expects the aim they set to hold. | **Steering is not aiming.** What you're steering (STEER.1) and where new things go (PLACE.1) are separate and both on screen. A visible shortcut can offer "aim here too", but nothing changes silently. |
| T3 | **What a tap on a result does** | Seeker wants it to play. Wanderer wants to look first. | **One consistent main action per kind of result, with details always one step away** (FIND.8b). Collections open, with an inline Play or Continue button (R8); playable items play at the aim (Q2), identically everywhere, with undo covering a mis-tap. Cameras and single photos show on the device in hand first (R10). |
| T4 | **Power vs safety on the queue** | Queue Builder wants instant reorder, remove, clear. Fixer wants nothing destroyed by accident. | **Undo instead of asking.** Reversible changes happen instantly and offer undo (RELY.4). Only truly irreversible actions ask first (RELY.8). How long undo lasts while a far screen is still waking is not yet defined (§6). |
| T5 | **Sending to a busy screen** | Big-Screen Sender wants it to just work. Whoever is watching that screen doesn't want to be cut off. | **Warn before replacing someone else's playback; never block.** The aim label shows a busy screen before any tap (PLACE.5, R2), and anyone can put it back from that screen's Remote (RELY.4, R13). |
| T6 | **Move or keep when sending** | Room Hopper wants this device to stop. A Sender starting a second room wants it to keep playing. | **Decide at the moment, with the remembered choice visible.** The keep-or-move choice appears whenever it applies, on every device size, pre-set to the last choice (PLACE.6). |
| T7 | **Routines vs people in the room** | Routine Setter wants predictable results. People in the room want to change what's on. | **Routines are just another starter; the latest person wins.** Routine starts are shown as such (HOUSE.5), steered like anything else (STEER), and never override a later human action (AUTO.2). |
| T8 | **How loud confirmation is** | Seeker wants no clutter. Sender and Fixer want certainty. | **Confirmation scales with distance; failure is always loud.** Quiet when the result is in your hands, explicit with progress when it's on another screen, and always a clear notice when something fails (RELY.1–RELY.5). |
| T9 | **Whose history** | Resumer wants everything the house played, including the TV. A Hand-Held Viewer may not want their late-night listening on the family list. | **One household list, always labelled with where it played** (Q3). |
| T10 | **Remembering a narrowed search** | A Seeker who narrows to Music wants it kept while they work. The next Seeker is confused by results limited to Music. | **Narrowing is always visible, and an empty narrowed search widens with a note.** Narrowing lasts until search closes (Q6), the same on every device. |
| T11 | **Guests vs the host's queue** | Guests want their song now. The Host wants the evening's queue safe. | **Playing one item never wipes a queue (R1), and a host can set a screen to add only (PLAY.10).** |
| T12 | **Anyone can rename vs routines need stable targets** | People want readable names they choose (Q10). The Routine Setter and Setup person need routines that never break. | **Routines follow the screen, not its name; names are unique, and renames show "was…" (R31).** |
| T13 | **A child's taps vs the grown-ups' places** | The Child taps everything, repeatedly. The Resumer and Host want their spots and queues untouched. | **Spots are kept per screen (R14), repeated taps start once (R34), single plays keep the queue (R1), and anyone can remove items from the household list (FIND.13).** |

---

## 5. Owner decisions

The open questions from the first draft, answered by the owner on 2026-09-14. Each decision is applied to the stories and tensions listed.

| # | Question | Decision | Applied to |
|---|---|---|---|
| Q1 | Should a device's aim return to "this device" on its own? | **Yes, after idle time.** The aim holds while the app is in active use; after 2 hours of no use it returns to "this device". The clock doesn't run while the aimed screen plays what this device sent (R4), and idle beats a reload's restore (R7). | PLACE.2a, RELY.7a, T1 |
| Q2 | What does tapping a result do? | **Depends on the kind of thing.** A collection (show, season, album, playlist, artist, folder) opens. A playable item (episode, song, film) plays at the aim. Details are a secondary action on every item; undo covers a mis-tap. Collections also carry an inline Play or Continue button (R8). **Exception:** cameras and single photos show on the device in hand first, with Show on… second (R10). | FIND.7a, FIND.8b, T3 |
| Q3 | Whose history, unfinished items, and suggestions? | **One household list**, each item labelled with where it played. No "who's watching". Each screen keeps its own resume spot (R14), and anyone can remove an item from the list (R15). | FIND.7, FIND.9, FIND.10, FIND.13, PLAY.4a, T9 |
| Q4 | Order of several "play next" items? | **The order they were added.** | PLAY.5a |
| Q5 | Do photos, live channels, and cameras have queues, positions, and moves? | **Photos queue** like video and audio (a slideshow). **Live channels and cameras are tuned**: no queue, no position, started fresh when sent to another screen. | STEER.7a, PLACE.7a |
| Q6 | How long does a narrowed search kind last? | **Until search closes.** The next search starts at All. Same on every device. Search stays open after playing or adding (R24), and widened results are labelled (R25). | FIND.1a, FIND.2a, FIND.4a, T10 |
| Q7 | Should people watching a screen get a sign when someone elsewhere changes it? | **A brief note on that screen** naming where the change came from, with Put it back. No permission step. Only pause, stop, replace, and move produce notes (R30). | STEER.1b, RELY.4b |
| Q8 | How do several screens playing at once behave? | **Start together, steered separately.** They may drift apart; there is no group control, but either screen can line up with the other again (R29). | PLACE.4a |
| Q9 | Which words go in the product? | **Play on · Queue · Remote.** Button verbs are Play, Play next, Add to queue, Play on…, and Move to… (R28). | Words note, all stories |
| Q10 | Who may name a screen, and which screens can routines target? | **Anyone can name a device** from the app; TVs and kiosks come already named. **Any named screen**, including a browser left open on a wall tablet, can be a routine target. Routines follow the screen, not its name, and names are unique (R31). | HOUSE.4a, AUTO.1b |
| Q11 | Should children be limited in what or where they can play? | **Out of scope for this redesign.** Revisit as its own concern if needed. | — |

---

## 6. Changes adopted from the adversarial review

The owner triaged the 50 proposals in the adversarial review of this document (2026-09-14): 47 accepted and applied above, 3 rejected. Numbers marked *(default)* in acceptance criteria are starting values to tune, not decisions.

**Accepted and applied**

| Area | Proposals | Where |
|---|---|---|
| Taps and the queue | R1 one item keeps the queue · R2 busy screen and move-or-keep shown on the aim before the tap · R3 "someone else's playback" defined · R8 inline Play/Continue on collections | PLAY.1a, PLAY.2a, PLACE.5a, PLACE.6a, FIND.8b |
| Aim reset | R4 no reset while the aimed screen plays · R7 idle beats a reload | PLACE.2a, RELY.7a, T1 |
| Interruptions and undo | R10 cameras and single photos show here first · R11 show briefly, then return · R13 put it back from the affected screen | FIND.8b, PLAY.8, RELY.4a, RELY.4b |
| History | R9 continue by default · R14 a spot per screen · R15 remove from the household list · R16 carry on skips what's on | PLAY.4a, FIND.7a, FIND.10a, FIND.13 |
| New controls | R17 sleep timer · R18 pause or stop all · R19 subtitles and audio language · R20 queue end and next episode | STEER.10–13 |
| Reach | R21 handle covers the last screen sent to, plus lock screen · R22 buttons on each house row · R23 add from inside Remote · R24 search stays open | STEER.1a, HOUSE.2a, STEER.1b, FIND.1a |
| Search and words | R25 labelled widening · R26 one shuffle rule · R27 play-next position · R28 fixed button verbs | FIND.4a, PLAY.2a, PLAY.3a, STEER.9a, PLAY.5a, words note |
| Several screens and failed presses | R29 line up again · R30 quieter notes · R34 repeated taps start once · R35 no late presses | PLACE.4a, STEER.1b, PLAY.1a, STEER.3a |
| Screens and routines | R31 routines follow the screen · R32 tidy the screen list · R33 routine history · R36 status visible to everyone | HOUSE.4a, AUTO.1b, HOUSE.6, AUTO.4, HOUSE.2a |
| Reliability | R37 no stacked warnings · R38 reload comes back paused, screens survive a power cut · R42 stop and turn the screen off · R49 "This device (Dad's phone)" | RELY.3a, RELY.7a, STEER.6a, PLACE.1a |
| New content jobs | R39 add-only queue · R40 played earlier and favourites · R41 mark watched · R43 music behind a slideshow | PLAY.10, FIND.11, FIND.12, FIND.10a, PLAY.9 |
| People and the model | R44 comfortable use · R45 Bystander, Ambient listener, Host, Setup person, Child · R46 measurable wording · R47 matrix fixes · R48 ownership and path fixes · R50 first use | RELY-A, P11–P15, §4.1, §4.2, PLACE.3b, AUTO.1b, RELY.14 |

**Rejected, and what that leaves**

| Proposal | Consequence |
|---|---|
| R5 Show that the aim was reset ("was Living Room TV") | After an idle reset the aim simply reads "This device", with no reminder of the old aim. R4 makes a reset during an evening's viewing unlikely. |
| R6 A "home aim" for wall tablets and kiosks | Every device resets to itself. A kitchen tablet used as the speaker's remote has to be aimed again after 2 hours of no use. |
| R12 Undo that accounts for a slow far screen | Undo lasts 10 seconds from the tap. On a TV that takes 40 seconds to wake it can run out before the result appears; there is no "Cancel" while a screen is still starting, and undo on a live channel is undefined. Revisit when screens are designed. |
