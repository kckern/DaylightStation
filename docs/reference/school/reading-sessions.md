# Living-room reading sessions — lifecycle and state machine

> **Status:** design, settled 2026-08-26. Not yet built.
> Implementation plan: `docs/_wip/plans/2026-08-26-preschool-reading-03-livingroom-session-screen.md`.
> This document is the authority on *behaviour*; the plan is the authority on *how*.

A preschooler taps their own NFC card on the living-room reader, the TV opens to a
screen scoped to them, they tap a book sticker, it plays, and finishing it counts
toward that day's reading assignment.

Every state, every input, and every transition is enumerated here. Nine branches
were undecided when this was first mapped. All are now settled; each is marked
with its original **D-number** where it appears, and §8 lists them together.

---

## 1. The alphabet

The whole feature has **three real inputs** and **two ambient facts**. That is small
enough to enumerate exhaustively, which is why this document can claim coverage.

| Input | Source |
|---|---|
| `card` | a personal NFC card, resolving to a learner |
| `book` | a book NFC sticker, resolving to content |
| `ended` | the player reports the current item finished |

Derived / internal:

| Input | Source |
|---|---|
| `expire` | the confirm countdown ran out |
| `unknown` | a tag that resolves to nothing |
| `timeout` | the session sat untouched for ~2 minutes |

| Ambient fact | Why it matters |
|---|---|
| TV power | decides whether a tap must wake it |
| Something already playing | decides whether a tap interrupts, queues, or is refused |

---

## 2. Mode — the central concept

**A session is in one of two modes, and the same input means different things in
each.** This is the distinction that makes the machine tractable.

| Mode | When | Posture |
|---|---|---|
| **assignment** | the learner is enrolled in story-time **and** `count < target` | **Hardened.** Finish what you started: a book tapped mid-story is refused. |
| **browsing** | not enrolled, **or** the target is already met | **Relaxed.** Nothing is owed, so mid-story taps behave like the TV normally does. |

**Mode is derived on every evaluation, never stored.** It is a pure function of the
reading log and the enrollment, so it cannot go stale, and it flips by itself the
moment the last required story finishes.

Two consequences worth stating plainly:

- **A non-enrolled card needs no special case.** An older sibling's card opens a
  perfectly ordinary session that happens to be in browsing mode. Their reads are
  still logged; nothing is counted. **[D1]**
- **Browsing mode is also what a child gets after finishing.** Re-tapping their card
  once the target is met reopens the session relaxed.

---

## 3. What already exists — read this before building anything

**The queue already has a change-your-mind window, and it is not the one the
requirements describe.**

The living-room NFC source is configured `action: play-next`. That routes through
`ScreenActionHandler.handleMediaQueueOp`
(`frontend/src/screen-framework/actions/ScreenActionHandler.jsx:199`), which branches
on whether a player is mounted:

- **No player mounted** → mount a fresh `Player` overlay. The book plays
  **immediately**. A repeat of the same content inside `MEDIA_DEDUP_WINDOW_MS`
  (**3 s**) is suppressed.
- **Player mounted** → dispatch `player:queue-op` into the running player
  (`frontend/src/modules/Player/Player.jsx:1233`), which then:
  1. refuses if the content is already playing → flashes the on-deck chip;
  2. refuses if the content is already on-deck → flashes;
  3. **if the current item has played for less than `preempt_seconds` (default 15 s,
     `backend/src/4_api/v1/routers/config.mjs:16`) → replaces it in place**;
  4. otherwise → pushes it **on-deck**, to play when the current item ends.

So today, a second book tapped 5 seconds in *swaps*, and one tapped 5 minutes in
*queues*. That is a good design for a grown-up putting on music.

**In assignment mode the session claims the tap and refuses it, so none of the above
runs. In browsing mode the session does not claim it and all of the above applies
unchanged.** That is the whole interaction between the new feature and the existing
queue — one branch, stated once.

**End-of-content teardown already exists, and it is a live hazard.** `end: tv-off` on
the `livingroom` location flows as `endBehavior` + `endLocation` into the content
query (`WakeAndLoadService.mjs:275`), and `sideEffectHandlers['tv-off']`
(`backend/src/3_applications/trigger/sideEffectHandlers.mjs:21`) calls
`tvControlAdapter.turnOff(location)` when content ends. **Left unmodified it would
power the TV off the instant a story ends — before the ceremony could render.** The
session must suppress the location's `end` behaviour while it is open and run
teardown itself. **[D8]**

---

## 4. The happy path

```mermaid
sequenceDiagram
    autonumber
    actor K as Child
    participant R as Living-room reader
    participant B as Backend
    participant TV as Living-room TV

    K->>R: taps personal card
    R->>B: trigger livingroom nfc uid
    Note over B: resolves to learner_action:<br/>reading-session
    B->>B: open session, derive mode
    B->>TV: wake, route to reading screen
    TV-->>K: avatar, prompt to pick a book,<br/>today's count, yesterday's reads

    K->>R: taps a book sticker
    R->>B: trigger livingroom nfc uid
    Note over B: interceptor CLAIMS it —<br/>session open at this location
    B->>TV: book-selected
    TV-->>K: cover, title, sound cue, countdown

    Note over K,TV: countdown — another book swaps the pick

    TV->>TV: countdown expires
    TV->>B: play the book
    TV-->>K: story plays

    TV->>B: ended, with pickId and learner
    B->>B: RecordStoryRead to the reading log
    B-->>TV: story-read on the school topic
    TV-->>K: back to their screen, 2 of 2

    alt target now met
        TV-->>K: ceremony — good job
        TV->>B: teardown
        B->>TV: tv-off
    else still owed
        TV-->>K: prompt for the next book
    end
```

---

## 5. States

| State | Meaning |
|---|---|
| `OFF` | TV off, no session |
| `TV_IDLE` | TV on, no session, nothing playing — menu or art screensaver |
| `FOREIGN_PLAY` | Content playing that no reading session started |
| `PROMPT` | Session open; "what do you want to read?" |
| `CONFIRM` | Book picked; countdown running; nothing playing yet |
| `READING` | The story is playing, attributed to the learner who picked it |
| `CELEBRATE` | The read just met the daily target |
| `TEARDOWN` | Closing the session and powering the TV off |

`FOREIGN_PLAY` is deliberately its own state and not a flavour of `READING`. The
distinction — *did a reading session start this?* — decides whether a tap may
interrupt and whether a completion is credited. Collapsing them is how a family
movie ends up logged as somebody's homework.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> OFF

    OFF --> PROMPT: card
    OFF --> FOREIGN_PLAY: book, no session
    TV_IDLE --> PROMPT: card
    TV_IDLE --> FOREIGN_PLAY: book, no session

    FOREIGN_PLAY --> FOREIGN_PLAY: card — refused, D2
    FOREIGN_PLAY --> TV_IDLE: ended

    PROMPT --> CONFIRM: book
    PROMPT --> PROMPT: another card — swap learner
    PROMPT --> TEARDOWN: timeout, D6

    CONFIRM --> CONFIRM: different book — swap pick
    CONFIRM --> READING: expire, or same book again D10
    CONFIRM --> PROMPT: another card — drop pick, D3
    CONFIRM --> TEARDOWN: timeout, D6

    READING --> READING: card — swap context only, D4
    READING --> READING: book — assignment mode refuses, D5
    READING --> CONFIRM: book — browsing mode relaxes, D5
    READING --> CELEBRATE: ended, target met
    READING --> PROMPT: ended, still owed

    CELEBRATE --> TEARDOWN: ceremony done
    CELEBRATE --> PROMPT: any tap cancels, D7
    TEARDOWN --> OFF: tv-off
    TEARDOWN --> PROMPT: any tap cancels, D7
```

---

## 6. The two hard inputs

### `card` — who is standing at the reader

```mermaid
flowchart TD
    A[card tap] --> B{tag known?}
    B -->|no| B1[unknown-tag capture:<br/>observed registry plus phone push]
    B -->|yes| C{carries school_learner?}
    C -->|no| C1[not a learner card —<br/>normal trigger dispatch]
    C -->|yes| D{reader declares<br/>learner_action?}
    D -->|no| D1[no_handler — named refusal,<br/>acknowledged on screen]
    D -->|yes| E{current state}
    E -->|OFF or TV_IDLE| F[wake TV, open session,<br/>derive mode, PROMPT]
    E -->|FOREIGN_PLAY| G[D2: refuse visibly.<br/>content keeps playing]
    E -->|PROMPT| H[swap learner, re-derive mode]
    E -->|CONFIRM| I[D3: swap learner, DROP the pick]
    E -->|READING| J[D4: swap context only.<br/>story keeps its original credit]
    E -->|CELEBRATE or TEARDOWN| K[D7: cancel teardown, reopen]
```

### `book` — what to read

```mermaid
flowchart TD
    A[book tap] --> B{session open<br/>at this location?}
    B -->|no| B1[unclaimed — plays as it does today.<br/>credited to nobody]
    B -->|yes| C{tag resolves<br/>to content?}
    C -->|no| C1["D9: say so on screen.<br/>still write observed registry plus push"]
    C -->|yes| D{current state}
    D -->|PROMPT| E[CONFIRM: cover, cue, countdown]
    D -->|CONFIRM, different book| F[swap pick, restart countdown]
    D -->|CONFIRM, same book| G[D10: confirm now,<br/>skip the rest of the countdown]
    D -->|READING| H{mode?}
    H -->|assignment| H1[D5: refuse.<br/>finish this one first]
    H -->|browsing| H2[D5: do not claim —<br/>existing queue rules apply]
```

---

## 7. Transition matrices

Every state against every input. `—` means the input cannot arrive in that state.
The two modes differ in exactly one cell, which is the point of the distinction.

### Assignment mode — hardened

| State | `card` | `book` | `ended` | `expire` | `timeout` |
|---|---|---|---|---|---|
| `OFF` | wake → `PROMPT` | plays → `FOREIGN_PLAY` | — | — | — |
| `TV_IDLE` | → `PROMPT` | plays → `FOREIGN_PLAY` | — | — | — |
| `FOREIGN_PLAY` | refuse visibly, stay | existing queue rules | → `TV_IDLE` | — | — |
| `PROMPT` | swap learner, stay | → `CONFIRM` | — | — | → `TEARDOWN` |
| `CONFIRM` | swap learner, drop pick → `PROMPT` | swap pick / same book confirms | — | → `READING` | → `TEARDOWN` |
| `READING` | swap context, stay | **refuse — finish this one** | target met → `CELEBRATE`; else → `PROMPT` | — | — |
| `CELEBRATE` | cancel → `PROMPT` | cancel → `CONFIRM` | — | — | → `TEARDOWN` |
| `TEARDOWN` | cancel → `PROMPT` | cancel → `CONFIRM` | — | — | → `OFF` |

### Browsing mode — relaxed

Identical, except:

| State | `book` |
|---|---|
| `READING` | **not claimed** — the existing preempt/on-deck rules apply unchanged |

---

## 8. Settled decisions

| # | Question | Decision |
|---|---|---|
| **D1** | A card not enrolled in story-time | Opens an ordinary session in browsing mode. Reads logged, nothing counted. No special case. |
| **D2** | A card tapped while unrelated content plays | **Refuse, visibly.** Brief on-screen acknowledgement; the content keeps playing. A reading session never seizes the TV from whoever is already watching. |
| **D3** | A different card during the confirm countdown | Swap learner and **drop the pick**. A pick belongs to whoever made it; transferring it would credit the wrong child. |
| **D4** | A card tapped mid-story | Context switches; the story keeps playing and is credited to whoever **picked** it. Attribution is decided at pick time. |
| **D5** | A book tapped mid-story | **Mode-dependent.** Assignment: refuse — finish this one first. Browsing: do not claim; the existing queue applies. |
| **D6** | Nobody picks a book | **~2 minutes quiet → `TEARDOWN` → TV off.** Same teardown as a finished session. The TV never stays on unattended and the next tap always lands in a fresh session. |
| **D7** | A tap racing `CELEBRATE` or `TEARDOWN` | **Any tap cancels teardown.** Powering off under a child who just tapped is the worst failure available; being wrong the other way costs one extra timeout. |
| **D8** | Does the TV always power off? | The session **suppresses the location's `end: tv-off`** while open and owns teardown timing, so the ceremony can render first. Not optional — see §3. |
| **D9** | An unregistered book tag inside a session | Say it on screen — "I don't know that book yet" — **and** still write the observed-registry entry and send the phone push so it can be enrolled. |
| **D10** | The same book tapped again during the countdown | **Confirm immediately**, skipping the rest of the countdown. A child tapping twice is expressing certainty, and the 3 s dedup window would otherwise swallow it. |
| **Repeats** | Re-reading a book already finished today | **Counts every time.** Simplest rule to explain, and no screen has to deliver bad news. Accepted trade-off: the target can be met by re-reading one short book. |
| **Completion** | The target is met mid-session | Ceremony, then teardown, then TV off. To read more, re-tap the card — which reopens in browsing mode. |

---

## 9. Failure paths

Not state transitions, but each must land somewhere visible.

| Failure | Behaviour |
|---|---|
| Content lookup fails | The player bails today. In a session: back to `PROMPT` with "that one didn't work" |
| TV fails to wake | The card tap must still answer; log and surface, never fail silent |
| Reading log write fails | The story still played. Surface it; never claim a read that was not recorded |
| Backend restart mid-session | Session state is in-memory and is lost — correct; nobody is at the reader after a restart |
| Player remounts mid-story | Must not double-count. `pickId` dedup in `RecordStoryRead` |
| `ended` fires twice | Same `pickId` dedup |
| Teardown suppression fails | The TV powers off before the ceremony. Guard with a test — this is the D8 hazard |

---

## 10. Invariants

1. **A read is credited only on completion** — never on pick, never on play.
2. **Attribution is decided at pick time** and travels with the pick.
3. **No session, no credit.** An unclaimed book tap plays and counts for nobody.
4. **Mode is derived, never stored.** It cannot go stale and it flips by itself.
5. **Every tap is acknowledged on screen** — the same rule the scan ceremony holds.
   A child who taps and sees nothing taps harder.
6. **A reading session never seizes the TV** from content already playing.
7. **In assignment mode: one story at a time.** No queue, no on-deck, nothing silent.
