# Media App JTBD Taxonomy: Adversarial UX Review

**Date:** 2026-09-14
**Reviews:** `docs/_wip/plans/2026-09-14-media-app-ideal-jtbd-taxonomy.md` (read on its own, with no other material)
**Status:** Findings for the owner to accept or reject item by item (§10).

## 1. Verdict

The top-level cut is sound. FIND / PLAY / PLACE / STEER / HOUSE / RELY / AUTO really does give "where will this play" one home, and most of the audit's tangles do go away under it. The model's weakness is that it describes one person, holding one device, doing one thing at a time. A real household has two people wanting the same TV, a phone left in a pocket through a two-hour film, a child tapping every picture, a doorbell ringing mid-episode, and a TV that takes 40 seconds to wake. Four things will make the design routinely do the wrong thing unless they're fixed at the model level:

- **Q1's idle reset** fires in exactly the situation the Big-Screen Sender exists for: the evening film.
- **Q2's immediate tap-to-play** is also promised a warning before replacing someone's programme and a keep-or-move choice. Those promises can't all be kept.
- **"Play now replaces what's on"** never says whether the queue survives.
- **Q3's single household list** makes everyone share one resume position per title.

Around those sit a set of everyday jobs that are missing: sleep timer, "stop everything", subtitles, what happens when the queue runs out, showing the doorbell camera and then going back to the film, and "what was that song". There's also a whole mode of intent with no persona: the person sitting at the screen that someone else just changed. None of this needs the decisions reversed. Most of it needs a sharper definition, a missing job, or a mitigation written into the acceptance criteria.

---

## 2. Top 10 findings

1. **Critical.** Q1's idle reset fires during a film the phone sent. The next "play next episode" tap then plays on the phone, not the TV. *(Q1, PLACE.2a, BS-1, T1)*
2. **Critical.** Q2 says a tap plays immediately. PLAY.1a and PLACE.5a say you're warned before replacing someone else's programme, and PLACE.6a says a keep-or-move choice appears. The model promises all three for the same tap. *(Q2, FIND.8b, PLAY.1a, PLACE.5a, PLACE.6a, T3, T5)*
3. **Critical.** "Play now replaces what's on at the aim" never says what happens to the queue. One tap on a song by a guest or a passing Seeker can wipe a two-hour dinner queue, and a Sender sending "several things in a row" replaces each one with the next. *(PLAY.1, FIND.9a, P3, P6, T4)*
4. **Critical.** Under Q3 there is one resume position per title for the whole house. A child watching the film from the start overwrites a parent's "34 min left", and whoever finishes it removes it from "carry on" for everyone. *(Q3, PLAY.4a, FIND.10a, RE-2, P9)*
5. **High.** There's no way to show something briefly and then go back. The doorbell camera on the TV replaces the film (cameras have no queue under Q5), and undo only lasts "a short time". *(Q5, PLAY.1, AUTO.1, RELY.4)*
6. **High.** Undo can't honestly undo on a far screen. The TV has already woken, a live channel has no position to restore, and a short undo window can run out before a 40-second wake even finishes. *(RELY.4a, T4, T5, Q5)*
7. **High.** The Seeker's own example, "Put on Bluey", is a collection, so Q2 opens it. Their fastest job takes 3–4 taps plus the continue-or-start-over question. *(P2, SK-1, Q2, PLAY.4a)*
8. **High.** There's no persistent handle for playback on another screen. STEER.1a only covers this device, so a Sender whose phone isn't playing needs 3 taps to pause the TV when the phone rings. *(STEER.1 vs STEER.1a, HOUSE.1a, P3, P10)*
9. **High.** Screen names aren't reliable enough to point routines at. Anyone can rename (Q10), yet the Routine Setter "does not tolerate a screen whose name changes". Wiped browsers come back as duplicates, and a routine that fails at 7 am is reported only to "anyone looking", which is nobody. *(Q10, HOUSE.4a, RS-3, AUTO.1a, P8)*
10. **High.** Core daily jobs have no home: sleep timer, stop or pause everything, subtitles and audio language, what happens when the queue ends, and "what was that song?". *(STEER-T, STEER-Q, FIND-R, HOUSE-O)*

---

## 3. Missing jobs

| Proposed job | Who needs it | Scenario | Where it belongs | Severity |
|---|---|---|---|---|
| **Sleep timer:** stop, or fade out, after N minutes or at the end of this chapter or episode | Hand-Held Viewer, Resumer, parents of children | A bedtime audiobook on a phone plays for three more hours after she falls asleep. Next day "carry on" puts her at chapter 19 when she remembers chapter 12. | STEER-T, new STEER.10. It also needs a "where I fell asleep" marker in PLAY.4. | High |
| **Stop or pause everything:** every screen, one action | House Watch, Fixer | 10 pm. The kids' tablet, the kitchen speaker and the living-room TV are all going. STEER.6 works one screen at a time: 3 × 3 taps. The same need arises when leaving the house or taking a phone call with the whole downstairs playing (Q8 gives no group control). | STEER-T, new STEER.11, surfaced in the HOUSE overview. It is an all-screens action, not a saved group, so Q8 stands. | High |
| **Subtitles and audio language** for whatever I'm steering | Hand-Held Viewer, House Watch, anyone with hearing loss or a language learner | Grandparents visiting need subtitles on the TV. A film starts in the dubbed language. Nothing in STEER covers either. | STEER-T, new STEER.12. It must work from the Remote as well as here (STEER.1b's "same controls"). | High |
| **What happens when the queue runs out:** stop, repeat, or keep similar things going | Ambient listener, Lineup Builder, Host | Dinner music finishes at 8:40 in the middle of dessert and the house goes silent. Or the TV sits on the final frame of an episode with nobody deciding what's next. | STEER-Q, new STEER.13, next to repeat and shuffle. | High |
| **Next episode automatically, with a countdown and "stop after this one"** | Resumer, parents, a child alone | RE-3 says "it continues, or they choose it" but never which. A child binges five episodes, or a parent has to fetch the phone at the end of every episode. | STEER-Q, as an amendment to STEER.7 (it currently shares RE-3 with FIND.10). | High |
| **Show something briefly, then return:** doorbell camera, announcement, a quick clip | Everyone in the room; Routine Setter | The doorbell rings during a film. The camera goes on the TV (by tap or routine), replacing the film and its queue. When the camera closes, nothing comes back. | PLAY-S, new PLAY.8 ("interrupt, then put back what was on"), plus an AUTO.1 variant for triggers. | High |
| **At the screen that changed: see what changed, and put it back** | Bystander (see §9) | Mum is watching the TV. A child's tablet sends a cartoon to it. The TV shows "Replaced from Kid's tablet" (Q7), but only the tablet holds the undo. | RELY-C, extending RELY.4 so undo is reachable at the affected screen as well as from the sender. | High |
| **Controls outside the app** (lock screen, notification) for the playback I'm steering | Big-Screen Sender, Hand-Held Viewer, Fixer | The phone rings mid-film and the phone is locked. Pausing the TV means unlock, open the app, indicator, screen, pause. | STEER-H, extending STEER.1. | High |
| **"What was that song?":** see, item by item, what just played on a screen | Ambient listener, Host, anyone | A great track played on the kitchen speaker ten minutes ago in a shuffled playlist. FIND.9 lists recent *items*; it's unclear whether a track inside a queue counts. | FIND-R, new FIND.11, reachable from each screen's queue as "played earlier". | Medium |
| **Favourites or pinned items** | Seeker, child, Routine Setter | The same five things are put on every day (the morning programme, Bluey, white noise). Each is a full search or a scroll through "recent". | FIND-R, new FIND.12. It should appear in the FIND.7 suggestions. | Medium |
| **Remove something from the household list, or keep it off** | Hand-Held Viewer, anyone buying a gift, anyone watching something unsuitable for the kids' suggestions | T9 admits this tension, but Q3 offers no relief. The horror film watched after 11 pm shows up in "carry on" and "what the household plays" on the children's tablet the next morning. | FIND-R, new FIND.13. Q3's single list stays; its entries can be removed. | High |
| **Mark as watched or unwatched** | Resumer, parents | Credits skipped with 4 minutes left, so the film stays in "carry on" forever. Or a child already saw episode 6 at a friend's house. | FIND-R, as an amendment to FIND.10. | Medium |
| **Turn a screen off or on** as part of stopping or starting | Fixer, House Watch, Routine Setter | Stop the TV from bed: the playback stops, but the TV glows all night. RELY.2 implies screens get turned on; nothing turns them off. | STEER-T, as an amendment to STEER.6 ("stop, and turn the screen off"). | Medium |
| **Keep the house's screens tidy:** add, give a room, retire, merge duplicates | Setup person (see §9), Routine Setter | A new TV replaces the old one, and "Living Room TV (old)" sits in the overview as "last heard 41 days ago". The kitchen tablet's browser was wiped and now appears twice. Rooms are shown everywhere ("name and room") but no job assigns them. | HOUSE-K, new HOUSE.6. | High |
| **Know whether a routine worked when nobody was watching** | Routine Setter | The 7:00 morning programme failed because the wall tablet had gone to sleep. AUTO.1a reports failure to "anyone looking at that screen", and at 7:00 nobody is. | AUTO-O, new AUTO.4: a readable record of recent routine starts and their outcomes. | High |
| **Keep far screens' positions and queues through a power cut or restart** | Resumer, Lineup Builder | The power drops for 10 seconds. The phone recovers (RELY.7 covers this device only), but the TV's film position and the speaker's queue are gone. | RELY-K, extending RELY.7 to every screen. | Medium |
| **Pause hand-held playback when headphones disconnect or a call comes in** | Hand-Held Viewer | A podcast in earbuds on the bus. The earbuds die and the phone carries on out loud. | STEER-T, as a note on STEER.3. | Medium |
| **Music with a slideshow:** two things together on one screen | Host, Wanderer | A family photo slideshow on the TV at a birthday, with music behind it. Q5 gives photos a queue, but one screen has one queue. | PLAY-S, new PLAY.9 ("add music behind this slideshow"). | Medium |
| **Let others in the room add to the queue without replacing it** | Host, guests | A dinner party. Three guests open the app on their phones; each tap on a song (Q2) replaces the host's queue. | PLAY-L, new PLAY.10. A screen's queue can be set to "add only". This is a host protection, not a child limit, so it doesn't cross Q11. | High |
| **Comfortable use:** large text, screen-reader announcements, status not shown by colour alone, one-handed reach, readable in glare | Anyone with low vision, older relatives, one-handed parents holding a baby | The aim sits at the top of a tall phone, out of thumb reach. "Playing / paused / stale" is signalled only by colour. A confirmation appears and vanishes without being read aloud. | New RELY-A group ("Use it comfortably"), with jobs RELY.11–RELY.13, applied as a check on every AC. | High |
| **Know what's still playing at home after I've left, and stop it** | House Watch | In the car: "did I leave the kitchen speaker on?" HOUSE.3a says the overview "says so" when out of touch, but doesn't say whether the app is useful away from home. | HOUSE-O. Either state that away-from-home is out of scope, or extend HOUSE.1 and STEER.11. | Low |
| **Know when it will finish** ("ends at 9:47") | Wanderer, parents at bedtime | "Is there time for one more episode before bed?" FIND.8 shows length, not end time. | FIND-L and STEER-T, as a small amendment to FIND.8 and STEER.4. | Low |

---

## 4. Tap-count review

Taps are counted with the app already open and the phone unlocked. Typing is noted, not counted. A menu that has to be opened counts as one tap.

| Path | Minimum taps the model implies | Target | Proposed shortcut |
|---|---|---|---|
| **SK-1 "Put on Bluey"** (a show, so a collection) | Open search (1), type, tap Bluey, which opens it (2), tap Continue/Play (3), continue-or-start-over question (4) | 2 | Collection results carry an inline main button ("Continue S2E7" or "Play") on the result row itself. The tap on the row still opens it (Q2 intact). Continue is the default; "start over" sits in the confirmation. |
| **SK-1** playable item, aim on a TV playing someone else's programme | Search (1), tap result (2), replace warning (3) | 2 | Show what the aim is doing on the aim label *before* the tap ("Living Room TV · playing Planet Earth"). The warning becomes information you had in advance, and the tap stays one tap with undo. |
| **SK-1** playable item, aim on TV, phone already playing a podcast | Search (1), tap (2), keep-or-move prompt (3) | 2 | The remembered choice (PLACE.6a) shows on the aim label ("TV · phone keeps playing") and is not asked again at the moment of sending. |
| **SK-3** play next | Search (1), result menu (2), Play next (3) | 2 | An inline "Queue" button on each result, where holding it offers "next" or "end". |
| **BS-1** first send of the evening | Aim (1), choose TV (2), then SK-1 (2–4) | 4 | Put the most recently used screens at the top of the aim list. After a one-off "Play on…", offer "aim here for the evening" in the confirmation. |
| **BS-2** one-off Play on… | Item menu (1), Play on… (2), screen (3), possible busy warning (4) | 3 | The screen list shows what's playing on each (PLACE.5a) so the warning is already visible; no separate confirm. |
| **BS-4** aim back at the phone | Aim (1), This device (2) | 1 | The aim label carries a one-tap "back to this device" whenever it points elsewhere. |
| **P3 or P10 pause the TV because the phone rang** (phone not playing anything) | House indicator (1), screen (2), pause (3), plus unlock and open | 1 | A persistent Remote handle for the screen this device most recently sent to or steered, plus controls on the lock screen. |
| **Turn the TV down from the phone** | Indicator (1), screen (2), volume step (3+) | 1 | The Remote handle has volume steps. The phone's own volume buttons steer whatever the handle shows, with a visible label saying so. |
| **HW-3 stop the kitchen speaker** (urgent) | Indicator (1), screen (2), stop (3) | 2 | Pause and stop inline on each overview row. |
| **Bedtime: stop all three playing screens** | 3 × 3 = 9 | 2 | "Pause all" and "Stop all" at the top of the overview (new STEER.11). |
| **FX-3 undo a replace after the confirmation has gone** | No path defined | 2 | "Put back what was playing" in that screen's Remote for a generous period, and at the affected screen itself. |
| **FX: "why is my phone playing it?"** (should be on the TV) | Pause on handle (1), handle opens (2), Move to… (3), TV (4), possibly keep-or-move (5) | 2 | When something starts on this device right after an aim reset (Q1), the confirmation offers "Play on Living Room TV instead" in one tap. |
| **RH-1 TV to phone** | Indicator (1), screen (2), Move to this device (3) | 2 | "Move here" inline on the overview row. |
| **RH-2 phone to bedroom TV** | Handle (1), Move to… (2), screen (3), keep-or-move confirm (4) | 3 | No confirm step when the choice is pre-selected and shown in the list. |
| **HH jump back 10 s while browsing** | Handle (1), back 10 (2) | 1 | Jump-back on the compact handle for spoken word and video. |
| **Sleep timer for an audiobook** | Not possible | 2 | Handle (1), sleep (2), with a sensible default ("end of chapter"). |
| **RE-2 carry on** from the start page | Carry-on item (1), Continue (2) | 1 | A tap on a carry-on item continues; "start over" lives in the confirmation (keeps PLAY.4's choice without asking). |
| **RE-2 carry on after Q1 has reset the aim** (wants the TV) | Aim (1), TV (2), carry-on item (3), Continue (4) | 2 | Carry-on items show "last on Living Room TV · play there" as an inline second button (FIND.9a already labels where it played). |
| **RE-3 next episode** | Unspecified; worst case handle (1), queue (2), tap next (3) | 0–1 | Automatic continue with a countdown and "stop after this one". |
| **LB-1 add 15 songs** from separate searches | Per song: search (1), menu (2), add (3), and re-narrow to Music (+1) if search closed (Q6). About 60 taps. | ~1–2 per song | Inline "Queue" on results, and search stays open after a queue action, so Q6's narrowing lasts the whole building session. |
| **LB-3 or HW add an episode to the kids' room** (House Watch already in that screen's Remote, aim on phone) | Search (1), result menu (2), Add to… (3), kids' room (4) | 2 | "Add to this queue" inside the Remote opens the one search with "Adding to Kids' Room" stated for that search only. The aim is unchanged, so T2 holds. |
| **FX-4 start fresh** | Settings (1), Start fresh (2), review what to keep (3), confirm (4) | 4 | Acceptable. It is rare and destructive. |

---

## 5. Intent-to-result mismatch risks

| Scenario | Expected | Actual under the model | Severity | Mitigation |
|---|---|---|---|---|
| Dad aims at the living-room TV at 7 pm and starts a film. The phone lies on the sofa for 2 h (Q1 idle). At the credits he taps episode 2 of something. | Plays on the TV. | The aim has returned to "this device", so it plays on the phone, out loud, while the TV sits on the credits. | Critical | The idle clock doesn't run while the aimed screen is playing something this device sent; it starts when that screen goes idle. When a reset happens, the next time the aim is shown it reads "This device (was Living Room TV)", with a one-tap "aim back". |
| A Seeker taps a song. The aim is the TV where Mum is mid-film (Q2 + T5). | Either it plays at once, or there's a warning. | The model says both. A designer will pick one, and either the Seeker is slowed or Mum is cut off without warning. | Critical | State the rule once: if the aim is playing something started elsewhere, the aim label says so before any tap and the tap plays at once with undo. A separate warning step appears only when the aim is chosen or a one-off "Play on…" is sent. |
| The host built a 40-song dinner queue on the kitchen speaker. A guest's phone, aimed there, taps one song (Q2). | The song plays, then the dinner music carries on. | "Replaces what's on", and the queue's fate is undefined. If the queue goes, two hours of building are lost behind an undo that lasts "a short time". | Critical | Define PLAY.1: a single item plays now and the rest of the queue stays after it. Playing a *collection* replaces the queue, with undo. The confirmation says which happened ("Queue kept: 39 items"). |
| A Sender puts four episodes on for the kids "in a row" (P3's situation) by tapping each. | Four episodes lined up. | Each tap replaces the one before, so only the fourth plays. | High | When a new "play now" lands within a minute or so of the previous one on the same screen, the confirmation offers "Queue this instead" and shows what it replaced. |
| A child watches the film from the start on the tablet while Dad is at 1 h 20 m on the TV (Q3). | Dad's "continue" returns him to 1 h 20 m. | One household position, so Dad lands at the child's 0 h 12 m, or the film drops off "carry on" when the child finishes. | Critical | Keep one list, but keep a position per screen. "Continue" shows the choices when they differ: "1 h 20 m (Living Room TV) · 12 m (Kid's tablet)". Finishing on one screen removes the item only when no other screen has an open position. |
| Checking the baby monitor or doorbell camera on the phone while aimed at the TV (Q2: a camera is playable). | See the camera on the phone. | The camera replaces the film on the family TV. Q5 gives cameras no queue, so the film's place in the queue is gone too. | High | Cameras and single photos default to showing on the device in hand, with "Show on Living Room TV" as the second action. If Q2 must stand as written, a camera sent to a playing screen shows over the playback and closes back to it (new PLAY.8), never replacing it. |
| The doorbell routine puts the camera on the TV mid-film. | The camera shows, then the film resumes. | The film is replaced. Undo, if still offered, sits on nobody's phone. | High | PLAY.8 "interrupt and return" as an explicit routine option; AUTO.1 defaults cameras to it. |
| A TV takes 40 s to wake. The Seeker taps undo at 20 s. | Undo cancels the send. | Unclear. The TV may still wake, show the item, then revert, or the undo window expires before the start is confirmed. | High | The undo window counts from the moment playback is confirmed on the far screen. Before confirmation, the action reads "Cancel", which also stops the wake. Undo of a replace on a screen that was off offers "and turn it back off". |
| Undo after replacing a live football match. | Back to the match. | Live content has no position (Q5), so "restores the previous item, position, and queue" can't be met. | Medium | Undo on live content returns to the channel at the live point, and the confirmation says "back to live". |
| A Lineup Builder presses "Play next" on A, B, then C (Q4). | C is next ("play next" means next). | C plays third. | Medium | Keep Q4, but the confirmation says the position ("Next · 3rd in line") and the queue marks the "next" block. Holding "Play next" offers "at the very front". |
| "Queue" (Q9) vs "Add to lineup" (PLAY.6a) vs "add to the end" (P2, P6) vs "Up next". | One verb. | The document already uses three names for one verb. | Medium | Fix the product verbs: **Play**, **Play next**, **Add to queue**, **Play on…**, **Move to…**. Ban the rest in product copy. |
| A person taps "Shuffle" on an album (PLAY.3a), then later taps "Play" on another album. | The second album plays in order. | STEER.9 treats shuffle as a queue setting that persists ("set once"). PLAY.3a says it doesn't carry over. Which wins is undefined, so the second album may shuffle. | Medium | Starting any collection sets queue shuffle to what that verb says (Play = off, Shuffle = on). STEER.9's shuffle only reorders the running queue. Turning it off restores the original order. |
| Shuffle is on in the queue and the person adds "Play next". | Plays next. | Unclear whether shuffle scatters it. | Low | Items placed next are never shuffled. State it in STEER.9a. |
| A Seeker narrows to Audiobooks, types "The Hobbit", no match, and search widens (Q6). They tap the top result. | The audiobook. | It's the film, now playing on the TV (Q2). | High | Widened results sit under a divider ("Not in Audiobooks. From everything:") with the kind shown in words on every row. When a source failed (FIND.3), don't widen silently; say "Audiobooks didn't answer". |
| "Kitchen + Living Room" music in an open-plan ground floor (Q8). | Same music everywhere. | The screens drift and echo. After someone skips on one, adjacent rooms play different songs. | High | See Q8 in §7. Offer "line them up again" on either screen's Remote, and warn when choosing screens in the same or adjacent rooms. Adding to the queue with a several-screen aim adds to each, and the confirmation says so. |
| Mum pauses the kids' TV from upstairs (Q7). | The kids see why. | Fine. But a *speaker* has nothing to show a note on, and each volume step produces a note, so the film gets a stack of notes. | Medium | Notes only for pause, stop, replace and move; volume changes are grouped into one. On screens that can't show a note, it appears in that screen's overview entry instead. |
| The morning routine fires at 7:00 on the TV where someone has been watching the news since 6:50 (T7). | The routine doesn't clobber a person. | T7 only protects *later* human actions, so the routine replaces the news. | High | A routine targeting a screen a person started playback on in the last N minutes either waits or shows over the playback, per the routine's own setting, and says so. |
| Dad's phone is steering the TV. He taps "Move to this device" and then "This device" on the aim. | Both mean the phone. | They do, but while a laptop plugged into the TV is steering, "this device" *is* the TV. | Low | Label it "This phone", "This laptop" or "This tablet" using the device's own name ("This device (Dad's phone)"). |
| The kitchen wall tablet is used as a control panel for the kitchen speaker (Q1). | Taps play on the speaker. | After every idle stretch the aim returns to the tablet itself, so the next tap plays on the tablet's small speaker. | High | See Q1 in §7: a device's "home aim". |
| A phone reloads or crashes while playing out loud in a meeting (RELY.7a). | Its place is kept. | "What was playing" is restored, and it may start playing aloud. | Medium | After a reload, restore everything *paused* unless the reload happened within a few seconds of playback. |
| The phone loses Wi-Fi. The person presses pause on the TV, nothing happens, and they walk over and use the TV remote. | The pause either happened or didn't. | If the press is held and delivered later, the TV pauses 30 s after they resumed it by hand. | High | A press on a screen that can't be reached says "not sent" and is never delivered late. |
| A person taps "carry on" for a film that's playing *on the TV right now*, from a phone aimed at the TV (FIND.10a only excludes "this device"). | Takes them to it. | It restarts it, or starts it twice. P9 says this is intolerable. | High | Exclude anything playing on *any* screen from "carry on", or turn that item into "Now on Living Room TV · open Remote · move here". |
| A Seeker taps the result again because a 40 s wake looks like nothing happened. | One start. | Two starts, or a duplicate queue entry. AUTO.2 protects only routines from duplicates. | High | Apply AUTO.2's "one result for a repeated trigger" to repeated identical taps too. While a start is in progress for that item and screen, the result shows "Starting on Living Room TV…". |
| A Hand-Held Viewer taps an item in the queue while trying to drag it (STEER.8a: tapping plays now). | Reorder. | It plays now. On another screen's queue, that jumps the TV. | Medium | A tap on a queue item on another screen asks nothing, but its confirmation offers undo and names the screen. Dragging uses a clearly separate handle. |
| A named browser screen is renamed by a child from "Kitchen tablet" to "Poo" (Q10). | Routines still work; people still recognise it. | Routines "target by name"; confirmations now read "Playing on Poo". | Medium | Routines follow the screen, not the text of its name. Every rename shows in the overview for a while as "Poo (was Kitchen tablet)". Names must be unique. |

---

## 6. Contradictions and gaps in the model

1. **Tap-now vs warn-first vs ask keep-or-move.** *(Critical)* FIND.8b and Q2 say a playable tap plays at the aim. PLAY.1a's last AC says "I'm told what I'm about to replace *before it happens*". PLACE.6a says the keep-or-move choice is "shown at that moment" whenever this device is playing. A single tap can't satisfy all three. T3 and T5 each resolve their own half and never meet.
2. **"Someone else's playback" has no definition.** *(High)* PLAY.1a, PLACE.5a and T5 hinge on it, but Q3 removes any notion of who is watching. The only possible meaning is "started from another device or by a routine". So a parent who sent the film from their phone and then picks up the tablet is warned about their own film, and a child using the parent's phone is not. The model should state the rule in people's terms.
3. **Stable names vs anyone can rename.** *(High)* P8's priorities ("does not tolerate a screen whose name changes"), RS-3 ("keeps that name") and HOUSE.4a ("the name stays the same") all conflict with Q10 ("anyone can name or rename a device").
4. **The aim restored after a reload vs the aim reset after idle.** *(Medium)* RELY.7a restores "my aim" after a reload or crash; Q1 and PLACE.2a return it to this device after idle. Opening the app the next morning (a reload after a long idle) is both. Say which wins; idle should.
5. **PLACE.4's motivation contradicts Q8.** *(High)* PLACE.4 exists "so that the whole downstairs hears the same music". Q8 accepts that the screens drift apart and can't be controlled as one. In an open-plan space, drift *is* not hearing the same music.
6. **STEER.1 promises more than its stories deliver.** *(High)* The job reads "always see which playback I'm steering, reach it from anywhere, and switch to another screen's". STEER.1a gives a persistent handle only "while anything is playing or paused on *this device*". STEER.1c gives the TV route only from a confirmation or the house overview. So the Sender's primary playback, the TV, has no persistent handle.
7. **Shuffle is owned twice with conflicting persistence.** *(Medium)* PLAY.3a: shuffling a collection "doesn't change shuffle for anything I start later". STEER.9a: shuffle is set "once", as a setting of the queue. The split in §4.3 (C4) names the separation but doesn't settle what "Play" does when the queue's shuffle is on.
8. **Next episode lives in two places and is decided in neither.** *(Medium)* FIND.10 ("what comes next in a series") and RE-3's path (FIND.10a → STEER.7a) both touch it, and P9's path says "it continues, or they choose it". Nothing owns *whether* it continues on its own.
9. **Busy-screen warning owned twice.** *(Low)* The AC sits in PLAY.1a and in PLACE.5a. PLAY's own charter says it "does not own where it plays". Move the AC entirely to PLACE.5.
10. **Adding to another screen's queue owned twice.** *(Low)* PLAY.6b ("add to…") and PLACE.3a ("add to lineup on…") describe the same act. PLAY.6b should become a story under PLACE.3.
11. **RELY.1a vs T8.** *(Low)* RELY.1a: "the same outcome confirms the same way, whichever control". T8 and RELY.1a's own third AC: quiet when here, explicit when far. These reconcile only if "the same outcome" includes the destination. Say so.
12. **The undo window is set against the wrong clock.** *(High)* RELY.4a's "for a short time" and T4's "undo instead of asking" assume the result is visible at the moment of the tap. On a far screen it isn't (RELY.2 exists precisely because it isn't).
13. **Acceptance criteria that can't be observed as written.** *(Medium)*
    - "After a stretch of no use" (PLACE.2a) and "for a short time" (RELY.4a, STEER.8a): a tester can't pass or fail either.
    - "hasn't reported recently" (HOUSE.3a, PLACE.5a) and "within a couple of seconds" (STEER.3a): the same problem.
    - "suits the moment" (FIND.7): the same problem.
    - "What it shows matches what other people see" (HOUSE.2b) needs two people and two devices, and the AC should say so.
    - "Findable where a person would expect settings" (RELY.8a) is untestable.

    Each needs a number, or at least a person-visible statement ("the aim label shows how long until it returns to this device").
14. **AUTO.1a reports failure only to watchers.** *(High)* P8 "does not tolerate silent failure", but the only failure report is "visible to anyone looking at that screen in the overview". An unattended 7:00 routine fails silently in practice.
15. **Routine authoring is out of scope, but the Routine Setter is a persona with Primary groups.** *(Medium)* The P8 situation ("sets things up once, often on a laptop") has no job in the app. Every RS path is an outcome for other people. Either say plainly that P8 is a stand-in for the household's experience of routines, or give it jobs: test a routine, see its history, find which routines point at a screen before renaming or retiring it.
16. **AUTO.1b is assigned to the wrong persona.** *(Low)* It's a Hand-Held Viewer story about a wall tablet nobody is holding. It belongs to the Routine Setter.
17. **Persona paths skip steps.** *(Medium)*
    - SK-1 omits FIND.8b (the tap rule it relies on), PLAY.4a (the continue question a started episode will raise) and PLACE.5a (the busy-screen check).
    - BS-1's path has no FIND step, so it goes straight from aim to play.
    - LB-3's persona path says "chooses which screen's lineup they are working on", but no job owns "choose which queue I'm editing" apart from STEER.1's switch. The mapped path then uses PLACE.3a ("play on…"), which is a play verb, not an add.
    - FX-1 assumes the failure notice is seen "wherever they are in the app". If the phone was locked when the TV failed, there is no later record (no failure history job).
    - WA-2 includes PLAY.4a, the continue-or-start-over choice, which is not "check it's right".
18. **Matrix ratings that don't match the persona text.** *(Low)*
    - **P2 Seeker, PLACE-A: S → P.** Priority 4 is "does not tolerate a tap going somewhere unexpected" and SK-1's path includes PLACE.1a.
    - **P5 Hand-Held Viewer, PLACE-A: S → P.** Priority 1 is "taps stay on this device", and HH-1's path is PLACE.1a → PLACE.2b.
    - **P7 Room Hopper, PLACE-A: S → P.** RH-2's primary path runs through PLACE.5a and PLACE.6a.
    - **P10 Fixer, RELY-K: S → P.** FX-4 is RELY.8, which is in RELY-K.
    - **P4 House Watch, PLAY-L: R → S.** PLAY.6b is written as a House Watch story and sits in HW-3's path.
    - **P6 Lineup Builder, HOUSE-O: R → S.** LB-3's path begins at HOUSE.2a.
    - With P2, P5 and P7 raised, the §4.1 reading note becomes stronger: PLACE-A is Primary for four personas.
19. **HOUSE owns "screen names" but the Wanderer rates HOUSE-K "Never".** *(Low)* WA-3 has the Wanderer reading the aim's screen name ("Living Room TV") before playing. Recognising a screen *is* HOUSE.4, so that cell should be R at least.
20. **FIND "never changes what is playing" vs Q2.** *(Medium)* §2.1 says FIND "never changes what is playing". Under Q2, a tap on a search result (a FIND surface) plays. The charter should read: FIND hosts PLAY verbs but owns none of them. Otherwise designers will argue about whether a result row may carry play at all.

---

## 7. Stress-testing the owner's decisions

### Q1: Aim returns to "this device" after idle

- **Risk (Critical):** A film or a long queue sent from the phone runs for longer than the idle stretch, so the reset happens mid-evening and the next tap plays on the phone.
  **Mitigation:** Don't count idle time while the aimed screen is playing something this device started or steered. Start counting when that screen goes quiet.
- **Risk (High):** The reset is silent, so the person discovers it only when the phone starts playing out loud.
  **Mitigation:**
  - Before the reset, the aim label shows a gentle "returns to this device in 10 min".
  - After it, the label reads "This device (was Living Room TV)", with one-tap "aim back".
  - The first play after a reset gets a larger destination line in its confirmation, plus "Play on Living Room TV instead".
- **Risk (High):** A wall tablet or kiosk used as a control panel for one speaker or TV keeps snapping back to itself.
  **Mitigation:** Allow a device a "home aim", which is what the aim returns to after idle. It defaults to itself, so Q1 holds for every phone. This bends Q1's wording for kiosks, so the owner should accept or reject it explicitly (R6).
- **Risk (Medium):** A several-screen aim resets and the person doesn't notice that the downstairs group is gone.
  **Mitigation:** The same "was Kitchen + Living Room" label.

### Q2: Collections open; playable items play at the aim

- **Risk (Critical):** The Seeker's defining example ("Put on Bluey") is a collection, so the fastest job gets slower.
  **Mitigation:** An inline main button on collection results and rows ("Continue S2E7" / "Play"). The row tap still opens, so Q2 is intact.
- **Risk (Critical):** The rule collides with the busy-screen warning and the keep-or-move prompt (§6.1).
  **Mitigation:** Move both to information shown *before* the tap, on the aim label. Allow no in-between prompt for a playable tap.
- **Risk (High):** People can't tell a collection from a playable item before tapping (an audiobook, an artist, a film with extras, a single photo, a channel).
  **Mitigation:** A visible marker on every row that means "opens" or "plays", plus a published list of which kinds are which. Test with someone who hasn't seen the app.
- **Risk (High):** A child, or a guest, taps pictures and each tap fires at the TV.
  **Mitigation:** Undo reachable from the affected screen itself, and a Q7 note on that screen. Q11 keeps limits out of scope, so this is recovery, not prevention.
- **Harmful as written, for cameras and single photos.** A parent checks the nursery camera while aimed at the family TV, and the camera replaces the film for the whole room. Keep Q2 for video, audio and whole slideshows. For cameras and single photos, make "view here" the main action and "Show on…" the second one, or at minimum make a camera sent to a playing screen show over the film and return to it (PLAY.8).

### Q3: One household list; no "who's watching"

- **Risk (Critical):** One shared resume position per title.
  **Mitigation:** Keep positions per screen within the one list, and show the choice only when positions differ.
- **Risk (High):** Late-night or sensitive viewing appears in "carry on" and in the time-of-day suggestions on a child's tablet the next morning.
  **Mitigation:** Anyone can remove an item from the list (FIND.13). Suggestions weight what was played *on or near this screen*, so the list stays single and each screen's view of it differs.
- **Risk (Medium):** "Finished items drop off" removes a title that someone else is halfway through.
  **Mitigation:** Drop an item only when no screen holds an open position.
- **Risk (Medium):** "Carry on" fills with things a child abandoned after 30 seconds.
  **Mitigation:** A minimum amount watched before an item counts as unfinished.
- **Harmful combined with Q11.** The household's adult viewing feeds the suggestions shown to children, and nothing can take it out. FIND.13 alone would mitigate it without introducing profiles.

### Q4: Several "play next" items play in the order added

- **Risk (Medium):** "Next" doesn't mean next for the third item. With several people adding at a party, their items interleave in ways nobody predicts.
  **Mitigation:** Confirmations state the position ("3rd in line"). The queue visibly groups the items placed next. Holding "Play next" offers "at the very front".

### Q5: Photos queue; live channels and cameras are tuned

- **Risk (High):** A camera or channel "play now" replaces a film and its queue, and there's nothing to return to.
  **Mitigation:** PLAY.8, "show over and return". The replaced queue is kept, so it can be restored beyond the undo window.
- **Risk (Medium):** Undo of replacing a live channel can't restore a position.
  **Mitigation:** Undo returns to live, and says so.
- **Risk (Medium):** A photo slideshow can't have music behind it, because one screen has one queue.
  **Mitigation:** PLAY.9, music behind a slideshow.
- **Risk (Low):** "Moving" a paused live channel starts at live, not where it was paused.
  **Mitigation:** The move confirmation says "moved at the live point".

### Q6: Narrowed kind lasts until search closes

- **Risk (High):** Widened results get tapped as if they were the narrowed kind, and a film plays when the audiobook was meant.
  **Mitigation:** A divider plus the kind in words on each widened row.
- **Risk (Medium):** A Lineup Builder has to re-narrow for every song if search closes after each action.
  **Mitigation:** Search stays open after Play, Queue and Play on…, and closes only when the person closes it. Q6 then naturally covers a building session.
- **Risk (Medium):** An empty narrowed search widens when the narrowed source actually failed, which hides the failure.
  **Mitigation:** A source failure takes precedence over widening. Say "Audiobooks didn't answer", then offer the widened results.

### Q7: A brief note on the changed screen, no permission step

- **Risk (Medium):** Notes stack up (volume steps, repeated skips) over subtitles or a slideshow.
  **Mitigation:** Notes only for pause, stop, replace and move. Grouped, small, time-limited, and never over subtitles.
- **Risk (Medium):** Speakers can't show a note.
  **Mitigation:** Record the note in that screen's overview entry and its Remote ("Paused from Mum's phone, 9:12").
- **Risk (High):** The note informs but gives the people in the room no recourse. A child's tablet can replace the parents' film and the parents can only read about it.
  **Mitigation:** The note carries "Put it back" at the screen, where the screen can be interacted with, and in that screen's Remote from any device.
- **Risk (Medium):** The note names a device, not a person. "From iPad" is useless and "From Poo" is alarming.
  **Mitigation:** Notes are only as good as names. Make HOUSE.4's naming prompt part of a device's first use.

### Q8: Start together, steered separately; drift allowed

- **Risk (High):** Drift and echo in open-plan rooms, and diverging songs after one skip.
  **Mitigation:** "Line up with Kitchen" on a screen's Remote, which re-starts this one at the other's point. It's an action, not a group control. The screen chooser warns when several chosen screens are in the same or adjacent rooms.
- **Risk (High):** Pausing all the music for a phone call takes N remote pauses.
  **Mitigation:** "Pause all" in the overview (STEER.11). It pauses every screen, not a group, so Q8 holds.
- **Risk (Medium):** "Add to queue" with a several-screen aim is undefined.
  **Mitigation:** It adds to each screen's queue in the same position, and the confirmation says "added on 2 screens".
- **Harmful for the job it claims to serve.** PLACE.4 is justified by "the whole downstairs hears the same music". With drift allowed, a family in a kitchen and living room that open into each other hears a stuttering echo within a song or two. Either keep Q8 and reword PLACE.4's motivation ("music in several rooms"), or allow the "line up again" action.

### Q9: Play on · Queue · Remote

- **Risk (Medium):** The document's own stories already use Play on…, Move to…, Play somewhere else, Add to…, Add to lineup on…, Add to the end and Up next.
  **Mitigation:** Extend Q9 to a complete verb list (§5 row on verbs) and apply it to every AC.
- **Risk (Low):** "Remote" names the controls only when they point at another screen, but STEER.1b says there is one set of controls.
  **Mitigation:** "Remote" is the header label ("Remote · Living Room TV"), not a different control set.

### Q10: Anyone names a device; any named screen can be a routine target

- **Risk (High):** A rename breaks, or silently retargets, routines.
  **Mitigation:** Routines follow the screen itself. A rename shows "was …" for a while, names must be unique, and renaming a screen that routines use says "used by 2 routines".
- **Risk (High):** A browser forgets it's the kitchen tablet (cleared, reinstalled) and appears as a new unnamed screen. The routine keeps pointing at the old one.
  **Mitigation:** HOUSE.6: merge "this is the Kitchen tablet" in one step, and retire dead screens.
- **Risk (High):** A routine targets a wall tablet that is closed or asleep, and the failure goes unseen.
  **Mitigation:** AUTO.4 keeps a routine outcome record. Screens that aren't open are shown as "not open", and a routine pointed at one is flagged in advance.
- **Risk (Medium):** Guests' phones get named and stay in the overview forever.
  **Mitigation:** Screens not heard from in weeks fold into "Other devices".

### Q11: Children out of scope

- **Risk (High):** Out of scope as limits, but children are still users. Tap-to-play (Q2), taking over the TV through the Remote, and household suggestions (Q3) all land on them.
  **Mitigation that doesn't cross Q11:**
  - undo at the affected screen (RELY.4 extension)
  - a Q7 note with "Put it back"
  - removing items from the list (FIND.13)
  - "stop after this episode" (STEER.13 amendment)

  None of these limit a child; all of them let the adults recover.
- **Risk (Medium):** Pre-reading children can't use search or read confirmations.
  **Mitigation:** Favourites (FIND.12) and picture-first suggestions give them a path without typing. See the Child persona in §9.

---

## 8. Sure-to-happen frustrations not covered above

1. **The house indicator always reads "1 playing".** *(Medium)* A wall tablet running an all-day photo slideshow or ambient music counts forever, so the indicator stops meaning anything. Let a screen be marked "background" so it's counted separately.
2. **Sticky "may not have started" notices pile up.** *(Medium)* RELY.3a keeps each unconfirmed notice until dismissed. A flaky speaker produces a stack by the end of the week. Replace older unconfirmed notices for the same screen, and clear them when that screen later reports playing.
3. **Only the sender sees a far screen's progress or failure.** *(High)* The phone's battery dies mid-send. The TV fails, and nobody else in the house can see why: RELY.5a covers "screens I started or am steering". Show the last attempt and its outcome on that screen's overview entry, for everyone.
4. **The overview briefly shows old information as live on waking the phone.** *(High)* The phone was asleep for an hour. On opening, the overview shows the kitchen speaker "playing" a song that stopped 50 minutes ago, before it refreshes. The "stale" mark (HOUSE.3a) must apply until fresh news arrives, not only to screens that stopped reporting.
5. **First run on a brand-new phone.** *(Medium)* The aim list is full of screens with room names but no sign of which one is "the TV we use". The carry-on list is someone else's evening. Nothing explains what the aim is. Add a first-use moment: name this device, and show what the aim label means, once.
6. **First run for a new household, where every list is empty.** *(Low)* Suggestions (FIND.7) and "carry on" are empty and the start page is blank. The empty state should lead into browsing by kind (FIND.5).
7. **The person who never learned the app.** *(High)* Grandma is at the TV. It changes channel ("Replaced from Dad's phone"). She can't undo it, doesn't know the phone app exists, and the TV's own remote may not be part of the model at all. See the Bystander persona in §9.
8. **Being aimed at a TV that is off.** *(Medium)* The aim label says "Living Room TV" but the TV is off and will take 40 s. The person taps, sees nothing, and taps again. The aim label should show "off · will turn on" before the tap.
9. **Hearing the result on the wrong device.** *(Medium)* With the aim on a speaker in another room, "play" gives no sound near the person. The confirmation is the only evidence, and it is "brief" on a small phone. For far audio screens, keep the confirmation until "playing" is confirmed (as for TVs).
10. **Two people steering the same TV at once.** *(Medium)* Both press skip within a second and two items get skipped. Each sees only their own confirmation. When a screen was just changed from elsewhere, a person's press on its Remote should say so ("Just skipped from Mum's phone").
11. **Trust erosion from "unavailable with a reason".** *(Low)* STEER.1b shows unsupported controls as unavailable with a reason. On a speaker, half the controls are greyed every time. Show the reason once per screen, then hide it behind a single "why are some controls missing?".
12. **Kids repeat-tapping the same picture.** *(Medium)* Ten taps on Bluey produce ten starts or ten queue entries. Covered by the duplicate-tap mitigation in §5; listed here because it will happen daily.
13. **Glare and distance on the garage or kitchen tablet.** *(Medium)* Status by colour alone ("stale" in pale grey), small progress bars and thin type are unreadable at arm's length in daylight. RELY-A.
14. **Losing the search when a notice appears.** *(Medium)* A failure notice (RELY.5a) appears "wherever I am". Tapping it to read it takes the person out of a half-typed search. Opening a notice must not discard what they were doing, and going back returns to the search with its text.
15. **"Start fresh" as a panic button.** *(Low)* The Fixer reaches for "start fresh" when the phone is merely aimed wrong. It then clears a queue they wanted. RELY.8a lets them keep parts, but "just fix where it plays" should be offered first, on the same screen.

---

## 9. Persona gaps

| Candidate | Recommend? | Why it changes priorities or paths |
|---|---|---|
| **Bystander** (at the screen that was changed; may not use the app) | **Yes, add as P11.** | Every current persona is the *actor*. T5, Q7 and the undo question are all about the person on the receiving end, who is never modelled. Priorities: know what changed and from where; put it back at the screen; see what's next without a phone; never be surprised by a routine. Paths run through the screen itself, not a phone. Without this persona, "Put it back at the screen", the routine-vs-person rule (T7) and the TV-side experience have no owner. |
| **Ambient listener** (wants something pleasant on, all day, with little attention) | **Yes, add as P12.** | Different priorities from the Lineup Builder: never silence (queue end, STEER.13); low-effort continuity across rooms; "what was that song" (FIND.11); pause all (STEER.11); not counted as "playing" noise in the overview. Paths start from favourites and "keep it going", not from building. |
| **Host** (party or dinner, with guests adding) | **Yes, add as P13; fold Guest into it.** | Changes the queue's safety model. "Play now" by other people must not replace the evening (PLAY.10, "add only"). Many devices add at once, so Q4 ordering matters. A guest's device is temporary and should leave the overview. A Guest on their own adds nothing beyond "a Seeker on a borrowed Wi-Fi", so they belong inside the Host's jobs. |
| **Setup person** (household keeper: new TV, rooms, dead screens, routines' health) | **Yes, either as P14 or by broadening P8.** | P8 currently has no in-app jobs and doesn't cover adding, retiring, merging or rooms. Paths: add a screen → name it → room → check routines pointed at the old one → retire the old one. The priority is a tidy, trustworthy screen list, which every other persona's PLACE choices depend on. |
| **Child** (pre-reader or early reader; taps pictures; watches the same thing repeatedly) | **Yes, as a mode of intent, with limits kept out of scope (Q11).** | Changes FIND and PLAY: no typing, can't read confirmations or warnings, repeat taps, favourites-first, "stop after this one". It doesn't ask for restrictions; it asks that the adult recovery paths (undo at the screen, remove from list, duplicate-tap protection) exist. Without it, Q2's immediate play is never tested against the household's most prolific tapper. |
| **Accessibility-dependent user** | **No as a persona; yes as a lens (RELY-A).** | Large text, screen readers, low vision, one-handed use and glare apply to every mode of intent. A Seeker with low vision has the Seeker's intent. Make it a required check on every AC, not a separate path. |
| **Guest** on their own | No (folded into Host and Bystander). | Separately, it only relabels Seeker or Sender. |

---

## 10. Proposed changes to the taxonomy

Each item can be accepted or rejected on its own.

- **R1:** Define PLAY.1's effect on the queue. A single item plays now and the rest of the queue stays; playing a collection replaces the queue, with undo. The confirmation says which happened.
- **R2:** Resolve the conflict between Q2, PLAY.1a and PLACE.6a. The busy-screen state and the remembered keep-or-move choice are shown on the aim label *before* a tap; a playable tap never shows an in-between prompt. Move the busy-screen AC from PLAY.1a to PLACE.5a.
- **R3:** Define "someone else's playback" in people's terms: started from a different device, or by a routine, in the current viewing.
- **R4:** Q1 idle clock: don't count idle time while the aimed screen is playing something this device started or steered.
- **R5:** Q1 reset visibility: the aim label shows "was Living Room TV" with one-tap "aim back", and the first play after a reset offers "Play on Living Room TV instead".
- **R6:** A device may have a "home aim" (defaults to itself) that the Q1 reset returns to, for wall tablets and kiosks. *(Bends Q1's wording; the owner decides.)*
- **R7:** State that the idle reset beats RELY.7a's restore of the aim.
- **R8:** Collection results and rows carry an inline main button ("Continue S2E7", "Play"). A row tap still opens it, per Q2.
- **R9:** Continue is the default for items with a saved position; "start over" is in the confirmation (amends PLAY.4a).
- **R10:** Cameras and single photos: "view here" is the main action and "Show on…" the second. *(Exception to Q2; the owner decides.)* If rejected, adopt R11 for cameras at minimum.
- **R11:** New PLAY.8, "show something briefly, then return to what was on". Used by camera sends and offered as a routine option in AUTO.1.
- **R12:** Undo on far screens: the window counts from confirmed playback. Before confirmation the action is "Cancel" (which also stops the wake). Undoing on a screen that was off offers to turn it off again. Undo on live content returns to live.
- **R13:** Extend RELY.4 so undo ("Put it back") is available at the affected screen and in its Remote from any device, not only on the sender's phone.
- **R14:** Keep resume positions per screen inside Q3's one household list. "Continue" offers the choice when they differ, and an item drops off only when no screen has an open position.
- **R15:** New FIND.13, "remove an item from the household list". Suggestions weight what was played on or near this screen.
- **R16:** "Carry on" excludes anything playing on any screen, or turns it into "Now on [screen] · Remote · move here" (amends FIND.10a and FIND.7a).
- **R17:** New STEER.10, sleep timer (minutes, or end of chapter or episode), with a "fell asleep here" marker for PLAY.4.
- **R18:** New STEER.11, pause all and stop all, from the overview.
- **R19:** New STEER.12, subtitles and audio language, for any screen being steered.
- **R20:** New STEER.13, what happens when the queue ends (stop, repeat, keep similar things going), plus next-episode auto-continue with a countdown and "stop after this one". STEER.13 owns it and FIND.10 only lists.
- **R21:** STEER.1a covers the screen this device most recently sent to or steered as well as this device, and adds controls on the lock screen or notification.
- **R22:** Inline pause, stop and "move here" on each row of the house overview (amends HOUSE.2a).
- **R23:** "Add to this queue" inside a Remote opens the one search with that screen as a stated one-off destination; the aim is unchanged (keeps T2).
- **R24:** Search stays open after Play, Queue and Play on…, so Q6's narrowing lasts through a building session.
- **R25:** Q6 widening: widened results sit under a divider with the kind in words on each row, and a source that failed is reported before widening.
- **R26:** Shuffle rule: starting a collection sets queue shuffle to what the verb says; STEER.9 shuffle reorders only the running queue; items placed next are never shuffled.
- **R27:** Q4 confirmations state the position ("3rd in line"); holding "Play next" offers "at the very front".
- **R28:** Extend Q9 to a full verb list (Play, Play next, Add to queue, Play on…, Move to…) and apply it to every story.
- **R29:** Q8: add "Line up with [other screen]" as a single-screen action, warn when several chosen screens share or adjoin a room, and define several-screen "Add to queue". Otherwise, reword PLACE.4's motivation.
- **R30:** Q7 notes only for pause, stop, replace and move; grouped; recorded in the overview for screens that can't display them; carry "Put it back".
- **R31:** Routines follow the screen, not its name. Names are unique, renames show "was…" for a while, and renaming a routine-targeted screen says so (reconciles Q10 with P8 and RS-3).
- **R32:** New HOUSE.6, keep the screen list tidy: add, assign a room, merge a re-appeared device, retire a dead one, fold long-silent devices away.
- **R33:** New AUTO.4, a record of recent routine starts and their outcomes, with advance warning when a routine targets a screen that isn't open.
- **R34:** Apply AUTO.2's "one result for repeated triggers" to repeated identical taps by people. Show "Starting on…" on the result while a start is under way.
- **R35:** A press on an unreachable screen says "not sent" and is never delivered late.
- **R36:** Far-screen progress and the last attempt's outcome appear on that screen's overview entry for everyone, not only the sender (amends RELY.5a).
- **R37:** Unconfirmed notices for the same screen replace each other and clear when that screen later reports playing (amends RELY.3a).
- **R38:** After a reload, restore playback paused (amends RELY.7a). Extend RELY.7 to far screens' positions and queues after a power cut.
- **R39:** New PLAY.10, "add-only" queue for a screen while hosting, so other people's "play" adds instead of replacing.
- **R40:** New FIND.11 (what played on a screen, item by item) and FIND.12 (favourites or pins).
- **R41:** Amend FIND.10 with mark watched or unwatched, and a minimum amount watched before something counts as unfinished.
- **R42:** Amend STEER.6: "stop, and turn the screen off" where the screen supports it.
- **R43:** New PLAY.9, music behind a slideshow.
- **R44:** New RELY-A group, "Use it comfortably": large text, spoken confirmations for screen readers, no status by colour alone, key controls within one-handed reach, readable in glare. Required check on every AC.
- **R45:** Add personas P11 Bystander, P12 Ambient listener and P13 Host (with guests folded in), and a Child mode of intent (limits still out of scope per Q11). Either add P14 Setup person or broaden P8 with in-app jobs.
- **R46:** Replace unobservable AC wording ("a stretch of no use", "a short time", "recently", "a couple of seconds", "suits the moment") with stated durations, or with person-visible indicators.
- **R47:** Fix the matrix cells in §6.18: P2, P5 and P7 PLACE-A to P; P10 RELY-K to P; P4 PLAY-L to S; P6 HOUSE-O to S; P1 HOUSE-K to R. Update the §4.1 reading notes.
- **R48:** Tidy ownership. PLAY.6b becomes a PLACE.3 story; AUTO.1b is reassigned to the Routine Setter. Reword FIND's charter to "hosts PLAY verbs, owns none". Fill the missing steps in SK-1, BS-1, LB-3 and FX-1 (§6.17).
- **R49:** Change PLACE.4's AC "Kitchen + Living Room" and the aim labels to use the device's own name for "this device" ("This device (Dad's phone)").
- **R50:** First-use moment on a new device: name it, and explain the aim label once. Give a new household's empty start page a lead into browsing by kind.

---

## 11. Owner triage (2026-09-14)

**Accepted (47):** R1–R4, R7–R11, R13–R50. Applied to the taxonomy; see its §6.

**Rejected (3):** R5 (announce an aim reset), R6 (home aim for kiosks), R12 (far-screen undo timing). The taxonomy's §6 records what each rejection leaves open.

