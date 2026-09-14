# Media App Redesign — Requirements

**Date:** 2026-09-14
**Status:** Draft for owner review. Priorities (P0/P1/P2) are proposed, not yet confirmed.
**Replaces on delivery:** [`docs/reference/media/media-app-requirements.md`](../../reference/media/media-app-requirements.md) (C1–C10, N1–N6). §9 reconciles every current requirement.
**Sources:**
- [Baseline audit](../audits/2026-09-14-media-app-jobs-to-be-done-baseline.md): the app as built; job IDs A1…K3.
- [Ideal jobs taxonomy](./2026-09-14-media-app-ideal-jtbd-taxonomy.md): jobs, stories and personas; owner decisions Q1–Q11 in §5; adopted review changes in §6.
- [Adversarial review](../audits/2026-09-14-media-app-jtbd-taxonomy-review.md): proposals R1–R50 and the owner's triage.

---

## 1. How to use this document

- **Keywords.** MUST, SHOULD and MAY are normative (RFC 2119).
- **IDs.** Requirements are `RQ-<AREA>-<nn>`, principles are `PR-<n>`, and non-functional requirements are `NF-<TOPIC>-<nn>`. IDs are stable. Retire an ID rather than reuse it.
- **Traces.** Each requirement names the taxonomy stories it satisfies (`FIND.8b`) and the decision (`Q2`) or adopted change (`R8`) behind it. Where it fixes current behaviour, it also names the audit job (`B1`).
- **Acceptance.** The acceptance criteria of the traced stories are the acceptance tests. A requirement is met when every criterion of every traced story passes.
- **Priority.**
  - **P0** is the first release: the separation-of-concerns core, plus the known defects.
  - **P1** is the second release.
  - **P2** comes later.
- **Defaults.** Values marked *(default)* are tunable starting points, collected in NF-DEF.
- **Functional only.** This document says what a person must be able to see and do. How each requirement maps onto the current system is in the implementation handoff.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Screen** | Anything that can play: a TV, a speaker, a kiosk tablet, or a phone, tablet or laptop using the app. |
| **This device** | The device the person is holding or using right now. |
| **Aim** | Where new content plays when the person says "play": this device, one screen, or several screens. Each device has its own aim. |
| **Queue** | What a screen is playing now, plus what comes next. |
| **Playable item** | Something that plays by itself: an episode, song, film, chapter or photo. |
| **Collection** | Something made of parts: a show, season, album, playlist, artist or folder. |
| **Live item** | A live channel or camera feed. It has no position and no queue. |
| **Remote** | The controls for playback on a screen other than this device. |
| **Handle** | The compact, always-visible control for the playback a person is holding on to. |
| **House view** | The list of every screen and what it is doing. |
| **Someone else's playback** | Playback on a screen that was started from a different device, or by a routine, since that screen was last idle. |
| **Note** | A brief message on a screen saying what another device or a routine just changed there. |
| **Spot** | The saved position in an item, kept per screen. |
| **Household list** | The shared record of what the household has played: recent, carry on, favourites, suggestions. It is not per person. |
| **Routine** | A button, tag or automation that starts playback with nobody using the app. |

## 3. Principles

These apply to every requirement. When a requirement and a principle seem to conflict, the principle wins and the requirement is corrected.

| ID | Principle | Traces |
|---|---|---|
| **PR-1** | **One aim.** Where new content plays is decided by exactly one setting per device, the aim. It is visible wherever a play or add action appears, and no control ignores it. The only exceptions are explicit one-off actions that name their screen: Play on…, Add to queue on…, Move to…, and Add to this queue. | PLACE.1a, T1 |
| **PR-2** | **One verb set.** Play, Shuffle, Play next, Add to queue, Play on… and Move to… mean the same thing on every item, on every surface, at every device size. | PLAY.1a, Q9, R28 |
| **PR-3** | **One tap rule.** Tapping a playable item plays it at the aim, and tapping a collection opens it. Cameras and single photos show on this device. Details are always one step away. | FIND.8b, Q2, R8, R10 |
| **PR-4** | **Steering is not aiming.** Controlling a screen never changes the aim, and changing the aim never changes what is being controlled. | STEER.1b, T2 |
| **PR-5** | **One set of controls for any playback.** Controls, queue and settings are the same, in the same layout, for this device and for any other screen. Controls a screen can't support show as unavailable, with a reason. | STEER.1b |
| **PR-6** | **One voice for outcomes.** Every change to playback or a queue reports its outcome through one confirmation system. The same outcome at the same distance reports the same way, and failures are always reported. | RELY.1a, T8 |
| **PR-7** | **Undo instead of asking.** Reversible changes happen immediately and offer undo. Only irreversible ones ask first. | RELY.4a, T4 |
| **PR-8** | **No silent change.** When another device or a routine changes a screen's playback, people at that screen can see what changed and where it came from, and can put it back. | RELY.4b, Q7, R13, R30 |
| **PR-9** | **Nothing lost by accident.** No single tap, by anyone, discards a queue, a spot or another screen's programme without undo. | PLAY.1a, R1, R14, T11, T13 |
| **PR-10** | **Honest state.** The app never shows stale state as live, a failed press as sent, or an unconfirmed start as playing. | HOUSE.3a, STEER.3a, RELY.3a, R35 |

## 4. Scope changes from the current requirements

The redesign deliberately reverses or extends these rules in the current spec.

| Area | Current rule | New rule | Driven by |
|---|---|---|---|
| Other devices using the app | Invisible to each other; only configured devices are targets. | Every device using the app is a named screen: visible in the house view, steerable, and a target for sends, moves and routines. | HOUSE.2b, HOUSE.4a, PLACE.7a–9a, AUTO.1b, Q10 |
| Personalisation | No watchlists, recommendations or history. | A household-level (not per-person) list: recent, carry on, favourites and suggestions. | FIND.7a, FIND.9a–13a, Q3 |
| Start page | Config-driven category cards. | Favourites, carry on and suggestions, plus browsing by kind. | FIND.5a, FIND.7a, FIND.12a |
| Stop or keep playing here when sending | Every send asks, transfer or fork. | A remembered choice, shown on the aim label. Only one-off sends ask. | PLACE.6a, R2 |
| Queue verbs | Play Now, Play Next, Add to Up Next, Add to Queue. | Play, Shuffle, Play next, Add to queue. Up Next is merged into Play next. | PLAY.5a, Q4, R28 |
| Adding screens | A configuration change only. | Screens can also be named, placed, merged and retired in the app. | HOUSE.4a, HOUSE.6a, Q10 |
| Routines | Not visible in the app. | "Started by" is shown on playback, and routine outcomes have a history. | HOUSE.5a, AUTO.4a |
| Controls outside the app | None. | Lock-screen and notification controls. | STEER.1a, R21 |
| Accessibility | A placeholder, out of scope. | Normative requirements. | RELY.11a–13a, R44 |
| Device-size parity | Features could be hidden on phones. | Every function is available at every supported size. | NF-DEV-02; audit D2, D5 |

---

## 5. Functional requirements

### 5.1 FIND — find something

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-FIND-01 | Search MUST be reachable in one step from every part of the app, at every device size. It MUST be the only search in the app: no surface may offer a second search with different results or actions. | P0 | FIND.1a, FIND.1b · A1, A3, G4 |
| RQ-FIND-02 | Results MUST appear as the person types. Each shows a picture, title and kind in words. | P0 | FIND.1a, FIND.4a |
| RQ-FIND-03 | After Play, Add to queue or Play on… from search, search MUST stay open with its text and narrowing. Closing search MUST return the person to where they were. | P0 | FIND.1a · R24 |
| RQ-FIND-04 | Search MUST be narrowable by kind and sub-kind, with the current kind always visible. Narrowing MUST last until search closes; the next search starts at All. | P0 | FIND.2a · Q6 · A2 |
| RQ-FIND-05 | Search MUST show when sources are still answering, clear that sign once all have answered, and name, in plain words, any source that didn't answer, with a retry. The wording MUST be the same everywhere. | P0 | FIND.3a · A3 |
| RQ-FIND-06 | When a narrowed search finds nothing, matches from all kinds MUST appear under a labelled divider. A source that failed MUST be reported before widening. An empty result MUST never look like one still loading. | P0 | FIND.4a · R25 |
| RQ-FIND-07 | Every kind of content MUST be browsable without typing, with a picture (or placeholder), title and kind on every entry. Long lists MUST load more as the person scrolls. Going back MUST return to the same scroll position. | P0 | FIND.5a · A4 |
| RQ-FIND-08 | Opening a collection MUST show its parts in natural order and a trail to every parent level. Whole-collection Play, Shuffle and Add to queue MUST sit at the top and name the aim. | P0 | FIND.6a · A5 |
| RQ-FIND-09 | Tapping a playable item MUST play it at the aim, and tapping a collection MUST open it. Collection entries MUST carry an inline Play, or "Continue <part>" when one is under way. Cameras and single photos MUST show on this device, with Show on… as the second action. This tap rule MUST hold on every surface. | P0 | FIND.8b, FIND.12b · Q2, R8, R10 · B1 |
| RQ-FIND-10 | Every item, wherever it appears, MUST open its details in one step: picture, title, description, length, kind and progress. Details MUST offer the full verb set naming the aim. Opening details MUST NOT change playback. | P0 | FIND.8a · A6 |
| RQ-FIND-11 | A household list of recently played items MUST include items played on any screen, each labelled with where it played, and each offering the full verb set. | P1 | FIND.9a · Q3 · A7 |
| RQ-FIND-12 | Carry on MUST list unfinished items with where they stopped, plus the next episode of a series. It MUST exclude anything playing on any screen right now, showing such items instead as "Now on <screen>" with Remote and Move here. An item counts as unfinished after 5 minutes or 5% *(default)* and as finished once the credits start. | P1 | FIND.10a · R16, R41 |
| RQ-FIND-13 | Any item MUST be markable as watched or unwatched. | P1 | FIND.10a · R41 |
| RQ-FIND-14 | Any item or collection MUST be addable to, and removable from, household favourites in one step, wherever it appears. Favourites MUST appear first on the start page, as large pictures. | P1 | FIND.12a, FIND.12b · R40 |
| RQ-FIND-15 | Any item in recent, carry on or suggestions MUST be removable from the household list in one step. It then disappears from suggestions on every screen, with undo. | P1 | FIND.13a · R15 |
| RQ-FIND-16 | The start page MUST offer suggestions drawn from favourites, unfinished items, what has played on this screen at this time of day, and new additions. It MUST never suggest anything that is playing anywhere. A household with nothing played yet MUST be led into browsing. | P2 | FIND.7a, RELY.14a · R15, R16, R50 |
| RQ-FIND-17 | Every screen's queue MUST offer a Played earlier list, newest first, with picture, title, time played and the full verb set. | P2 | FIND.11a · R40 |

### 5.2 PLAY — decide what plays

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-PLAY-01 | Play on a single playable item MUST start it now at the aim, keeping whatever was queued after the previous item. | P0 | PLAY.1a · R1 |
| RQ-PLAY-02 | Play on a collection MUST replace the aim's queue with the collection, in natural order with shuffle off, starting at the first unfinished part if there is one, and MUST offer undo. | P0 | PLAY.2a · R1, R26 |
| RQ-PLAY-03 | Shuffle on a collection MUST replace the aim's queue with the collection shuffled, and turn shuffle on. | P0 | PLAY.3a · R26 |
| RQ-PLAY-04 | Play next MUST place an item or collection immediately after what is playing. Several Play next actions play in the order added. The confirmation MUST state the position and screen. Pressing and holding MUST offer "At the very front". | P0 | PLAY.5a, PLAY.7a · Q4, R27 · C1 |
| RQ-PLAY-05 | Add to queue MUST append an item, or a collection in natural order, without interrupting playback. The confirmation states the position (or count) and the screen. | P0 | PLAY.6a, PLAY.7a · C2 |
| RQ-PLAY-06 | The verbs in RQ-PLAY-01 to 05 MUST be available on every item and collection wherever it appears, and MUST act on the aim. "Wherever" means search, browse, details, recent, carry on, favourites, suggestions and played earlier. | P0 | PLAY.1a · PR-1, PR-2 · B1, C1, C2, A7 |
| RQ-PLAY-07 | Repeating the same play on the same screen while it is still starting MUST start it only once, and the item MUST read "Starting on <screen>…". | P0 | PLAY.1a · R34 |
| RQ-PLAY-08 | Playing an item with a saved spot MUST continue from it, with Start over offered in the confirmation. When screens hold different spots, the person chooses between them. With no spot, the item starts from the beginning. | P1 | PLAY.4a · R9, R14 |
| RQ-PLAY-09 | Spots MUST be kept per screen within the one household list. An item leaves carry on only when no screen still has an open spot. | P1 | PLAY.4a, FIND.10a · R14 |
| RQ-PLAY-10 | A screen's queue MUST be switchable to Add only in one step. While it is on, Play from any other device adds instead of replacing, and says so. The house view MUST show that Add only is on, and anyone can switch it off. | P1 | PLAY.10a · R39 |
| RQ-PLAY-11 | Show briefly MUST put a camera or clip over a screen's current playback. When it closes or times out, the previous item, spot and queue return. Routines MUST be able to choose it, and camera starts by routines use it by default. | P2 | PLAY.8a, PLAY.8b · R11 |
| RQ-PLAY-12 | While a photo slideshow plays, Add music behind MUST start music that is steered separately from the photos. Stopping the slideshow asks whether to keep the music. | P2 | PLAY.9a · R43 |

### 5.3 PLACE — choose where it plays

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-PLACE-01 | Every device MUST have exactly one aim: this device, one screen or several screens. The aim MUST be visible wherever a play or add action appears, at every device size, as the screen's name and room, "This device (<name>)", or "<n> screens". | P0 | PLACE.1a · PR-1, R49 · D1 |
| RQ-PLACE-02 | The aim MUST be changeable in one step from wherever it is shown. "This device" MUST always be one of the choices, at every device size. | P0 | PLACE.2a, PLACE.2b · D2 |
| RQ-PLACE-03 | The aim MUST persist across navigation and reloads. After 2 hours of no use *(default)* it MUST return to this device, but that clock MUST NOT run while the aimed screen plays something this device sent or is steering. Opening the app after that idle time MUST start aimed at this device. | P0 | PLACE.2a · Q1, R4, R7 |
| RQ-PLACE-04 | Steering another screen MUST NOT change the aim. The aim shown MUST always be the destination actually used. | P0 | PLACE.1a, STEER.1b · PR-4 · D1 |
| RQ-PLACE-05 | Every item MUST offer Play on… and Add to queue on…, which send only that item to a chosen screen without changing the aim. | P0 | PLACE.3a, PLACE.3b · D3, G5 |
| RQ-PLACE-06 | Choosing a screen MUST show each screen's name, room and state: playing (with title and time left), paused, idle or off. Screens not heard from in 2 minutes *(default)* MUST be marked uncertain. Choosing a screen MUST warn before replacing someone else's playback. | P0 | PLACE.5a · F4 |
| RQ-PLACE-07 | When the aim is busy with someone else's playback, the aim label MUST say so before any tap. A play tap MUST never stop to ask. | P0 | PLACE.5a, PLAY.1a · R2, R3 |
| RQ-PLACE-08 | When this device is playing and the aim is another screen, the aim label MUST show whether this device will stop or keep playing, and let the person change it there. One-off Play on… and Move to… ask at the moment of sending, preset to the remembered choice. | P0 | PLACE.6a · R2 · D5 |
| RQ-PLACE-09 | The aim MAY be several screens. When it is: progress and outcome MUST be reported per screen, Add to queue adds to each screen, and the screens start together and are then steered separately. | P1 | PLACE.4a · Q8 · D4 |
| RQ-PLACE-10 | Either of two screens playing the same thing MUST offer "Line up with <other screen>". Choosing several screens in the same or neighbouring rooms MUST warn that drift may be audible. | P2 | PLACE.4a · R29 |
| RQ-PLACE-11 | Wherever another screen's playback is visible, Move here MUST move it to this device at the same spot and queue, and stop the other screen. If the move fails, the other screen keeps playing and the person is told why. | P0 | PLACE.7a · H1 |
| RQ-PLACE-12 | From the handle, Move to… MUST move this device's playback to a chosen screen at the same spot and queue, honouring the stop-or-keep choice. | P0 | PLACE.8a · H2 |
| RQ-PLACE-13 | From another screen's controls, Move to… MUST move that screen's playback to any other screen, including this device. | P1 | PLACE.9a |
| RQ-PLACE-14 | Video, audio and photo slideshows MUST move at the same spot. Live items MUST start fresh on the new screen. | P0 | PLACE.7a · Q5 |

### 5.4 STEER — control what's playing

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-STEER-01 | A handle MUST be visible in every part of the app whenever this device, or the screen this device most recently sent to or steered, is playing or paused. It shows title, picture, progress, play/pause and which screen it is. Tapping it opens full controls and the queue. It MUST NOT duplicate full controls while they are open. | P0 | STEER.1a · R21 · B3, B4, K3 |
| RQ-STEER-02 | A person MUST always be able to see which playback they are steering, and switch to another screen's playback in one step. | P0 | STEER.1b |
| RQ-STEER-03 | Controls for this device and for any other screen MUST be identical in content and layout. Controls a screen can't support MUST show as unavailable with a short reason. | P0 | STEER.1b · PR-5 · G1, G2 |
| RQ-STEER-04 | Controls for playback on this device MUST be available from the lock screen and system notifications. | P1 | STEER.1a · R21 |
| RQ-STEER-05 | A confirmation that something started on a screen MUST offer to steer it. The same route MUST stay available from the house view with no time limit. | P0 | STEER.1c · E4 |
| RQ-STEER-06 | Video MUST expand to fill the screen and shrink back without pausing or restarting. Audio shows a picture and title when expanded. | P0 | STEER.2a · B6 |
| RQ-STEER-07 | Play/pause, skip forward and skip back MUST be available for any playback. A press MUST be reflected within 2 seconds, or say that it hasn't happened yet. A press that can't reach its screen MUST read "not sent" and MUST never be carried out later. | P0 | STEER.3a · R35, R46 |
| RQ-STEER-08 | On-demand playback MUST support dragging to a position, with the time shown while dragging, and jumping a few seconds back or forward. Live playback shows "Live" and offers Go to live. | P0 | STEER.4a · B5, G2 |
| RQ-STEER-09 | Volume MUST be adjustable with large step targets as well as by dragging, with the level shown. Speed MUST be adjustable wherever the screen supports it. Changes apply to the screen being steered. | P0 | STEER.5a · B5, G2 |
| RQ-STEER-10 | There MUST be one Stop, meaning the same thing everywhere. It keeps the queue, says what remains, and leaves the queue reachable. Emptying the queue is a separate action. | P0 | STEER.6a · B7 |
| RQ-STEER-11 | Where a screen supports it, Stop MUST offer "and turn the screen off". | P2 | STEER.6a · R42 |
| RQ-STEER-12 | A sleep timer MUST stop playback after a chosen number of minutes, or at the end of the current chapter or episode. It fades out, shows the time left on the handle, and later offers to continue from where the timer was set. | P1 | STEER.10a · R17 |
| RQ-STEER-13 | Pause all and Stop all MUST be offered on the house view and the handle. Resume all MUST restore exactly the screens that were playing. Screens that couldn't be reached are listed. | P1 | STEER.11a · R18 |
| RQ-STEER-14 | Subtitles and audio language MUST be selectable for this device and for any screen. Only the options the item has are offered, and the choice carries on to the next episode of the same show. | P2 | STEER.12a · R19 |
| RQ-STEER-15 | The queue of any playback MUST be reachable in one step from the handle and from any screen's controls, including after stopping, until it is cleared or started fresh. It shows what is playing, what is next (including Play next items) and a count. | P0 | STEER.7a · C5, K3 |
| RQ-STEER-16 | Live items MUST be treated as single items with no queue and no position. Photos have a queue. | P0 | STEER.7a · Q5 |
| RQ-STEER-17 | Queue items MUST be reorderable (move up or down, and drag), playable by tapping, removable and clearable, identically for any screen. Remove and clear offer undo for 10 seconds *(default)*. | P0 | STEER.8a · C5, G3 |
| RQ-STEER-18 | Repeat (off, all, one) and shuffle MUST each appear exactly once, alongside the queue. They apply without interrupting playback and behave the same for any screen. Shuffle reorders only what is already queued, never shuffles Play next items, and restores the original order when turned off. | P0 | STEER.9a · R26 · C6 |
| RQ-STEER-19 | The end of every queue MUST offer stop, repeat, or keep similar things playing, with the current choice shown. Automatically added items are marked as such. | P1 | STEER.13a · R20 |
| RQ-STEER-20 | At the end of an episode, the next one MUST start after a visible, cancellable countdown. "Stop after this one" MUST be settable during an episode, from this device or a Remote. | P1 | STEER.13b · R20 |
| RQ-STEER-21 | When a device pauses, stops, replaces or moves another screen's playback, that screen MUST show a note naming the change, where it came from, and Put it back. Volume changes produce no note, and repeated notes are grouped. A screen that can't show notes records them on its house-view row. | P1 | STEER.1b, RELY.4b · Q7, R30 · PR-8 |
| RQ-STEER-22 | While steering another screen, Add to this queue MUST open the one search pointed at that screen, for that addition only, without changing the aim. | P1 | STEER.1b · R23 |

### 5.5 HOUSE — see the house

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-HOUSE-01 | One house indicator MUST be visible, once, everywhere in the app at every device size. It shows how many screens are playing or paused and opens the house view in one step. | P0 | HOUSE.1a · F1 |
| RQ-HOUSE-02 | The house view MUST list every screen, including this device (marked as such) and other devices using the app. Each shows name, room and state; playing screens also show picture, title and progress. Playing screens are listed first. | P0 | HOUSE.2a, HOUSE.2b · F2 |
| RQ-HOUSE-03 | Each house-view row MUST offer Pause, Stop and Move here directly. It MUST also open that screen's controls and offer Play on that screen. | P0 | HOUSE.2a · R22 |
| RQ-HOUSE-04 | Each house-view row MUST show that screen's current start progress, or its last failure, to everyone. | P1 | HOUSE.2a · R36 |
| RQ-HOUSE-05 | A screen not heard from in 2 minutes *(default)* MUST be marked with when it was last heard from. If this device loses touch with the house, the whole view MUST say so and recover on its own. Controls on an uncertain screen say the result may not be confirmed. | P0 | HOUSE.3a · F3 · PR-10 |
| RQ-HOUSE-06 | Every screen, including devices using the app, MUST have a unique human name. Anyone can name or rename a device in the app; TVs and kiosks come already named. A renamed screen shows "(was <old name>)" for 1 week *(default)*. Renaming a screen a routine uses warns first. Names persist across reloads. | P1 | HOUSE.4a · Q10, R31 · J3 |
| RQ-HOUSE-07 | A screen's playback MUST show how it started: from which device, or by which routine, and when. | P1 | HOUSE.5a |
| RQ-HOUSE-08 | A person MUST be able to add a screen, set its name and room, merge a duplicate, and retire a screen after being shown which routines target it. Screens silent for 30 days *(default)* fold into "Not seen lately". | P2 | HOUSE.6a · R32 |

### 5.6 RELY — rely on it

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-RELY-01 | Every action that changes playback or a queue MUST produce a confirmation naming the item and the screen. It is quiet when the result is on this device, and carries the screen's name and progress when it is elsewhere. Confirmations of the same kind replace each other. Wording and behaviour MUST NOT depend on which control started the action. | P0 | RELY.1a · PR-6 · A1, C2, C3 |
| RQ-RELY-02 | While a far screen gets ready, its steps MUST be shown in plain words that fit the kind of screen, and stay visible anywhere in the app until the outcome is known. | P0 | RELY.2a · E1, E2 |
| RQ-RELY-03 | Confirmed playback MUST read "Playing on <screen>", with Steer it. An unconfirmed start MUST say it may not have started, offer Steer it and Try again, and stay until dismissed. A newer unconfirmed notice for the same screen replaces the older one, and the notice clears once that screen reports playing. | P0 | RELY.3a · R37 |
| RQ-RELY-04 | Replacing what's playing, removing and clearing MUST offer undo for 10 seconds *(default)*, restoring the item, spot and queue. The same undo MUST be available as Put it back from the affected screen's controls on any device, and from the note on that screen. Irreversible actions ask first instead. | P1 | RELY.4a, RELY.4b · R13 · PR-7 |
| RQ-RELY-05 | Playback failures and skipped items MUST be reported wherever the person is in the app, naming the item, the screen and what plays instead. The handle shows a problem sign until recovery. This applies to this device and to any screen this device started or is steering. | P0 | RELY.5a · I4 |
| RQ-RELY-06 | Every failure MUST carry its own Retry, which retries exactly that attempt (same item, same screen), plus a way to send it to another screen. Several failures MUST appear separately. | P0 | RELY.6a · E3 |
| RQ-RELY-07 | After a reload or crash, the app MUST restore what was playing, its spot, its queue, repeat, shuffle and the part of the app the person was in, with playback paused. The aim is restored unless the idle time has passed. A brief network loss MUST NOT reload the app, and shows a quiet "reconnecting" note if it lasts. | P0 | RELY.7a · R7, R38 · I1, I3 |
| RQ-RELY-08 | Every screen MUST keep its spot and queue through a power cut. | P1 | RELY.7a · R38 |
| RQ-RELY-09 | Start fresh MUST be in this device's settings, one step from anywhere. It MUST list exactly what will be cleared (what's playing, the queue, the spot, the aim), let the person keep parts of it, and confirm first. | P0 | RELY.8a · I2 |
| RQ-RELY-10 | The current area of the app MUST always be indicated, including inside a queue or another screen's controls. Choosing the current area returns to its top without adding back steps. | P0 | RELY.9a · K1 |
| RQ-RELY-11 | Back, whether the device's or an on-screen one, MUST go one step to where the person came from. On-screen back controls are labelled with their destination. Closing a pop-up counts as one back. | P0 | RELY.10a · K2 |
| RQ-RELY-12 | On first use on a device, the app MUST ask for a name (with a default, and skippable) and explain the aim label once. | P1 | RELY.14a · R50 |
| RQ-RELY-13 | Text MUST follow the device's large-text setting without clipping. Every confirmation, warning and status change MUST be announced to screen readers. Status MUST never rely on colour alone. | P0 | RELY.11a · R44 |
| RQ-RELY-14 | On phones, the aim, play/pause and search MUST be reachable with one thumb. No essential action may need two hands. | P0 | RELY.12a · R44 |
| RQ-RELY-15 | Text and controls MUST stay legible in bright light and at arm's length (see NF-A11Y). | P0 | RELY.13a · R44 |

### 5.7 AUTO — let the house start things

| ID | Requirement | Pri | Traces |
|---|---|---|---|
| RQ-AUTO-01 | A routine MUST be able to start an item, queue or shuffled collection, with a volume, on any named screen, including a device left open in the app. It MUST start as fast as a person's send, and be reported like one. | P0 | AUTO.1a, AUTO.1b · J1 |
| RQ-AUTO-02 | Routines MUST follow the screen, not its name, so renaming a screen doesn't break them. | P1 | AUTO.1b · R31 |
| RQ-AUTO-03 | The same trigger fired twice within 10 seconds *(default)* MUST produce one start and no duplicate queue entries. Reloading a device a routine started MUST NOT restart its content. A person's later action on that screen always wins. | P0 | AUTO.2a |
| RQ-AUTO-04 | Every device using the app MUST report what it is playing to the house view and household displays. It shows as stopped soon after it closes, and tells its own user that it is visible to the house. | P0 | AUTO.3a · J2 |
| RQ-AUTO-05 | A routine history MUST list recent routine starts (when, which screen, what, and the outcome with a plain reason), and flag routines pointed at screens that are off or unreachable. | P2 | AUTO.4a · R33 |

**Coverage:** every one of the taxonomy's 69 jobs is traced by at least one requirement above.

---

## 6. Non-functional requirements

### NF-TAP — Interaction budgets

A tap is one deliberate touch or click, including opening a menu. Typing a search counts as zero taps. Budgets are measured with the app already open and nothing else in the way.

| ID | Path | Budget | Traces |
|---|---|---|---|
| NF-TAP-01 | A name typed → a playable item playing at the aim. | 1 tap | FIND.8b, SK-1 |
| NF-TAP-02 | A name typed → a collection playing at the aim, via inline Play. | 1 tap | R8 |
| NF-TAP-03 | Pause the screen this device last sent to, from anywhere. | 1 tap | R21, BS-3 |
| NF-TAP-04 | Open the queue of the playback being held, from anywhere. | 1 tap | STEER.7a |
| NF-TAP-05 | Add a search result to the aim's queue, or to play next. | 2 taps | PLAY.5a, PLAY.6a |
| NF-TAP-06 | Aim back at this device. | 2 taps | PLACE.2b, BS-4 |
| NF-TAP-07 | Move a screen's playback to this device. | 2 taps | PLACE.7a, R22 |
| NF-TAP-08 | Pause all screens. | 2 taps | STEER.11a |
| NF-TAP-09 | Retry a failed send, or put back a change. | 1 tap | RELY.6a, RELY.4b |
| NF-TAP-10 | Send one item to a screen other than the aim. | 3 taps | PLACE.3a |

### NF-TIME — Responsiveness

| ID | Requirement |
|---|---|
| NF-TIME-01 | Every tap MUST show a visible response within 100 ms. |
| NF-TIME-02 | Confirmation of an action on this device MUST appear within 500 ms. |
| NF-TIME-03 | A control on another screen MUST reflect its result, or say it hasn't happened yet, within 2 s (RQ-STEER-07). |
| NF-TIME-04 | The first progress step for a far screen MUST appear within 1 s of sending. |
| NF-TIME-05 | Search results MUST begin appearing within 1 s of a two-character query on the home network, and keep arriving as sources answer. |
| NF-TIME-06 | Playback on this device MUST start within 3 s of the tap for content that is available. |
| NF-TIME-07 | The start page MUST be usable within 1 s of opening, on a warm load. |
| NF-TIME-08 | A move between screens MUST resume within 2 s of the original spot. |

### NF-DEV — Devices and input

| ID | Requirement |
|---|---|
| NF-DEV-01 | The app MUST work on phones from 360 px wide, in portrait and landscape, and on tablets and desktops. |
| NF-DEV-02 | Every function MUST be available at every supported size. Layout may differ; capability may not. |
| NF-DEV-03 | Every action MUST be operable by touch, mouse and keyboard. On keyboards, a single key MUST focus search. |

### NF-A11Y — Comfortable use

| ID | Requirement |
|---|---|
| NF-A11Y-01 | The app MUST meet WCAG 2.2 level AA. |
| NF-A11Y-02 | Touch targets MUST be at least 44 × 44 px. |
| NF-A11Y-03 | Contrast MUST be at least 4.5:1 for text and 3:1 for controls and status indicators. |
| NF-A11Y-04 | Reduced-motion preferences MUST be honoured. |

### NF-REL — Reliability and scale

| ID | Requirement |
|---|---|
| NF-REL-01 | No single failure (a screen offline, content that won't resolve, a server error) MAY make the rest of the app unusable. |
| NF-REL-02 | Every disruption covered by RQ-RELY-05 to 08 MUST recover without a page reload. |
| NF-REL-03 | Playback on this device MUST continue while search and browsing are unavailable, as long as the content itself is reachable. |
| NF-REL-04 | A queue of 500 items MUST stay responsive. |
| NF-REL-05 | A tab left open for days MUST NOT grow noticeably slower or heavier. |
| NF-REL-06 | When two devices control the same screen at once, the last action wins, and the note (RQ-STEER-21) tells the people at that screen. |

### NF-OBS — Diagnosability

| ID | Requirement |
|---|---|
| NF-OBS-01 | Every outcome reported to a person (confirmation, failure, note, undo, "not sent") MUST also be recorded durably for diagnosis, with enough context to identify the device, screen, item and action. |
| NF-OBS-02 | Every aim change, idle reset, move, and Put it back MUST be recorded. |

### NF-DEF — Tunable defaults

| Setting | Default | Used by |
|---|---|---|
| Aim returns to this device after no use | 2 hours | RQ-PLACE-03 |
| Undo window | 10 seconds | RQ-RELY-04, RQ-STEER-17, RQ-FIND-15 |
| Screen marked uncertain if not heard from for | 2 minutes | RQ-PLACE-06, RQ-HOUSE-05 |
| Counts as unfinished after | 5 minutes or 5% | RQ-FIND-12 |
| Same trigger treated as one within | 10 seconds | RQ-AUTO-03 |
| Rename shows "(was …)" for | 1 week | RQ-HOUSE-06 |
| Silent screens fold away after | 30 days | RQ-HOUSE-08 |
| Next-episode countdown | 10 seconds | RQ-STEER-20 *(set here; not in the taxonomy)* |

---

## 7. Carried over from the current requirements

These still hold, restated functionally. The originals are cited for traceability.

| ID | Requirement | Was |
|---|---|---|
| RQ-KEEP-01 | Any content the platform can play MUST appear and play in the app with no app-specific change. | C2.4, N5.1 |
| RQ-KEEP-02 | A link that opens the app with content to play or queue MUST play or queue it on the opening device, exactly once across reloads. Such links MUST never send content to another screen. | C8.1, C8.2 |
| RQ-KEEP-03 | Other household systems MUST be able to control playback on a device using the app. | C8.4 |
| RQ-KEEP-04 | Playback that stops making progress MUST move on to the next item, and the person is told (RQ-RELY-05). | C9.3, C9.5 |
| RQ-KEEP-05 | A screen that goes offline MUST stay visible, with its last known state, and resume live updates when it returns. | C9.6 |
| RQ-KEEP-06 | Sending the same content to the same screen again while the first send is in progress MUST NOT start it twice or re-run the wake-up. | C9.8 |
| RQ-KEEP-07 | Several screens MAY be steered at once, alongside playback on this device and sends in progress. | C5.5, N4.1 |
| RQ-KEEP-08 | Steering another screen MUST NEVER change what is playing or queued on this device. | C5.6 |

## 8. Out of scope

- Accounts, sign-in, or "who's watching". History is household-level (Q3).
- Limits on what children can play, or where (Q11).
- Building or editing routines. The app shows their outcomes only.
- Group control of several screens as one, and synchronised multi-room playback (Q8).
- Administering live channels.
- Camera-specific controls (pan, zoom, detection overlays).
- Running this app's controls on the TVs themselves. TVs run the household screen player, which must meet the screen-side needs these requirements imply (notes, reporting, Show briefly).

## 9. Reconciliation with the current requirements

| Current | Status | Now |
|---|---|---|
| C1.1 inline live search, available everywhere | Changed: one search only, stays open after acting | RQ-FIND-01–03 |
| C1.1a results directly actionable | Changed: tap rule, uniform verbs | RQ-FIND-09, RQ-PLAY-06, RQ-PLACE-05 |
| C1.1b scope selection | Changed: scope resets when search closes | RQ-FIND-04 |
| C1.2 hierarchical browse | Kept | RQ-FIND-07, RQ-FIND-08 |
| C1.3 config-driven home | Replaced | RQ-FIND-14, RQ-FIND-16 |
| C1.4 detail view | Kept | RQ-FIND-10 |
| C2.1 one local session | Kept | — |
| C2.2 persist and resume | Changed: restores paused | RQ-RELY-07 |
| C2.3 reset session | Changed: itemised, partial keep | RQ-RELY-09 |
| C2.4 format-agnostic | Kept | RQ-KEEP-01 |
| C3.1 four queue actions | Changed: Up Next merged into Play next | RQ-PLAY-01–05 |
| C3.2 remove, reorder, jump, clear | Kept, plus undo | RQ-STEER-17 |
| C3.3 shuffle and repeat | Changed: shown once; shuffle rule defined | RQ-STEER-18 |
| C3.4 queue ops without interrupting | Kept | RQ-PLAY-05 |
| C3.5 same ops locally and remotely | Kept, broadened to all controls | PR-5, RQ-STEER-03 |
| C4.1 enumerate configured devices | Changed: includes devices using the app | RQ-HOUSE-02 |
| C4.2 per-device state detail | Kept | RQ-HOUSE-02, RQ-PLACE-06 |
| C4.3 per-device play history (deferred) | Now specified | RQ-FIND-17 |
| C4.4 live updates, stale marking | Kept | RQ-HOUSE-05 |
| C5.1–C5.4 peek control | Kept, renamed Remote | RQ-STEER-02, RQ-STEER-03, RQ-STEER-07–09 |
| C5.5 several at once | Kept | RQ-KEEP-07 |
| C5.6 peek never changes local content | Kept | RQ-KEEP-08 |
| C6.1 multi-target dispatch | Kept | RQ-PLACE-05, RQ-PLACE-09 |
| C6.2 every send asks transfer or fork | Replaced | RQ-PLACE-08 |
| C6.3 live dispatch progress | Kept | RQ-RELY-02 |
| C6.4 retry last dispatch | Changed: retry the exact failed attempt | RQ-RELY-06 |
| C6.5 per-dispatch options | Kept | RQ-AUTO-01 |
| C7.1 take over | Kept, as Move here | RQ-PLACE-11 |
| C7.2 hand off | Kept, as Move to… | RQ-PLACE-12 |
| C7.3 2 s position tolerance | Kept | NF-TIME-08 |
| C7.4 failure leaves the original intact | Kept | RQ-PLACE-11 |
| C8.1–C8.2 deep links, local only | Kept | RQ-KEEP-02 |
| C8.3 broadcast local state | Kept, broadened | RQ-AUTO-04 |
| C8.4 external control | Kept | RQ-KEEP-03 |
| C9.1 survive reload | Kept | RQ-RELY-07 |
| C9.2 crash recovery offer | Changed: restores paused | RQ-RELY-07 |
| C9.3 stall auto-advance | Kept, plus notice | RQ-KEEP-04, RQ-RELY-05 |
| C9.4 reconnect, mark stale | Kept | RQ-HOUSE-05, RQ-RELY-07 |
| C9.5 failure advance and retry | Changed: reported everywhere, exact retry | RQ-RELY-05, RQ-RELY-06 |
| C9.6 offline device stays visible | Kept | RQ-KEEP-05 |
| C9.7 play on without catalog | Kept | NF-REL-03 |
| C9.8 dispatch idempotency | Kept, extended to people's taps and routines | RQ-KEEP-06, RQ-PLAY-07, RQ-AUTO-03 |
| C10.1–C10.5 observability | Kept | NF-OBS |
| N1 performance | Kept, expanded | NF-TIME |
| N2 memory and scale | Kept | NF-REL-04, NF-REL-05 |
| N3 reliability | Kept | NF-REL-01, NF-REL-02 |
| N4 concurrency | Kept, plus notes | RQ-KEEP-07, NF-REL-06 |
| N5.1 new format, zero changes | Kept | RQ-KEEP-01 |
| N5.2 new device is config only | Changed: screens can also be added in the app | RQ-HOUSE-08 |
| N5.3 no bespoke branching | Kept | — |
| N6 accessibility placeholder | Replaced | RQ-RELY-13–15, NF-A11Y |
| Out of scope: peer-browser coordination | Removed | §4 |
| Out of scope: personalisation | Narrowed to per-person personalisation | §4, §8 |

## 10. Open items

| # | Item | Owner input needed? |
|---|---|---|
| O1 | **Undo while a far screen is still starting.** R12 was rejected, so RQ-RELY-04 counts 10 s from the tap. On a screen that takes 40 s to wake, undo can expire before the result appears. Undo on a live item is also undefined. | Yes, when screens are designed |
| O2 | **What "similar" means** for "keep similar things playing" (RQ-STEER-19) depends on what the content platform can recommend. | Discovery in the handoff |
| O3 | **What "this screen usually plays at this time of day" means** for suggestions (RQ-FIND-16) needs a definition. | Discovery in the handoff |
| O4 | **Turning a speaker off** (RQ-STEER-11) may be meaningless; such screens simply don't offer it. | No |
| O5 | **Priorities in this document are proposed.** The owner confirms P0/P1/P2 before the handoff sequences the work. | Yes |
