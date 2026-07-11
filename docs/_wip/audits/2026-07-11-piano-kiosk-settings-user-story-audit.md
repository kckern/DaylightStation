# Piano Kiosk Settings — User-Story & Intent Audit

**Date:** 2026-07-11
**Scope:** `frontend/src/modules/Piano/PianoKiosk/` settings surface — the chrome status chip (`PianoChrome.jsx`) and the sheet it opens (`PianoSettingsSheet.jsx`), plus the panels that sheet composes: `PianoKeyboardPanel.jsx`, `PianoMidiMonitor.jsx`, `PianoSoundContext.jsx`, `useScreenControl.js`, and the adjacent player chip (`PianoUserChip.jsx`).
**Lens:** user intent and user journeys. **This audit deliberately does not evaluate code quality, architecture, or correctness.** It asks one question: *what does a person walking up to this piano want to do, and which of those wants does the settings panel appear built to serve?*
**Verdict:** The panel is a well-stocked toolbox that quietly serves **two different people at once** — the family member who just wants a different piano sound, and the operator who maintains the kiosk. It supports a rich set of stories, but it never declares who it is for, so the everyday player and the technician share one door, one label, and equal billing. The result: the most common want (change the sound) and the rarest, most dangerous ones (fire raw MIDI, panic, reload the app) sit two taps apart with no seam between them.

---

## 1. The door: what the entry point signals

There is one way in, and it is doing three jobs at once.

The top-right chip (`PianoChrome.jsx:69`) shows a **connection dot** + the **active voice name**, is labeled **"Settings"** for screen readers, and **opens the settings sheet** when tapped. So a single element is simultaneously:

- a **status readout** ("you're connected, playing Grand Piano"),
- a **change-my-sound affordance** (the voice name invites a tap to change it), and
- the **catch-all settings entrance** (hardware, debugging, feedback, recovery).

Right beside it sits a *second* chip — the **user chip** (`PianoUserChip.jsx`), "who's playing." Two chips, two unrelated identity concepts (my *sound* vs. my *self*), styled as siblings. A first-time user cannot tell from the outside that one leads to instrument voices and the other to player switching.

**Intent read:** the door promises "settings" generically but visually advertises "sound." A player looking to change instruments will likely find it. A player whose piano has gone silent ("no piano found") has no signal that the fix lives behind the same chip, under a tab called *MIDI*.

---

## 2. The user stories this panel appears built to support

Grouped by the person doing the wanting. Each is phrased as the intent the surface implies, followed by the affordance that serves it.

### Persona A — The Player (a family member sitting down to make music)

> These are the stories the panel puts first (the Sound tab is the default tab).

- **A1. "I want to change the piano's instrument voice."**
  Sound tab → Keyboard panel: pick a voice *family* from a dropdown (Piano, Strings, …), then a specific voice from the grid (`PianoKeyboardPanel.jsx:33-46`). This is the marquee story — grand → electric → harpsichord → strings.

- **A2. "I want the sound to have some space/richness to it."**
  Sound tab → Keyboard panel FX row: toggle **Reverb** and **Chorus**, choose a type, set depth (`PianoKeyboardPanel.jsx:48-80`). The intent is "make it sound nicer," expressed as two named knobs.

- **A3. "I want a fuller, more realistic instrument than the built-in one."**
  Sound tab → Rendered voices: voice cards for the higher-fidelity bridge instruments (e.g. a sampled grand) alongside/instead of onboard timbres (`PianoSettingsSheet.jsx:101-135`). The tag ("Onboard" / "SFZ" / "FM") hints at *why* one sounds better, though in engine jargon.

- **A4. "That voice is too loud / too wet — let me balance it."**
  Sound tab → per-instrument **Gain** and **Reverb** sliders, shown only for rendered instruments (`PianoSettingsSheet.jsx:119-134`). The story is per-voice level trim.

### Persona B — The Operator (KC, or whoever keeps the kiosk alive)

> These are the stories the panel supports but never announces as a separate mode.

- **B1. "The piano isn't making sound — reconnect it."**
  MIDI tab → hardware status line + **Connect** button, plus a **Bluetooth settings** launcher into the OS pairing screen (`PianoSettingsSheet.jsx:144-162`). This is the single most likely *problem* a walk-up user hits, filed under the most jargon-heavy tab.

- **B2. "Turn the screen off."**
  MIDI tab → Display section, a two-tap armed "Turn off screen" (`PianoSettingsSheet.jsx:166-179`). Serves both burn-in protection and "I'm done, go dark at night." The two-tap guard shows the intent was recognized as *destructive-ish* (don't black out mid-play by accident).

- **B3. "Show me what the piano is actually sending."**
  MIDI tab → live raw-MIDI monitor, a rolling log of note/CC/PC traffic (`PianoMidiMonitor.jsx:51-64`). A pure diagnostics story — "is the hardware even talking?"

- **B4. "Let me poke the piano to test it."**
  MIDI tab → monitor outputs: send a **Program Change**, **Local On/Off**, **Panic** (`PianoMidiMonitor.jsx:39-49`). Technician stories: force a voice, un-stick local control, kill hung notes.

- **B5. "The audio subsystem is wedged — recover it without losing my place."**
  Footer → **Restart audio & MIDI** (reconnect + re-assert voice/effects) (`PianoSettingsSheet.jsx:206-213`). The lighter of the two recovery hammers.

- **B6. "Something is badly broken — reload the whole thing."**
  Footer → **Reload app** (`window.location.reload()`) (`PianoSettingsSheet.jsx:214-220`). The heavy hammer.

### Persona C — The Feedback-Giver (anyone, any moment)

- **C1. "This is broken / weird / I have an idea — let me tell you, now, by voice."**
  Feedback tab → **Record feedback** opens a voice-capture overlay tagged with the piano id (`PianoSettingsSheet.jsx:190-203`). The intent is captured *in situ*, at the moment of friction, without leaving the piano.

### Persona D — The Passer-by (reads, doesn't open)

- **D1. "Is the piano working right now, and what voice is it on?"**
  Answered without opening anything: the chip's dot + voice-name label (`PianoChrome.jsx:71-78`). A pure glance-and-go status story.

---

## 3. Persona map — who is this panel really for?

| Surface | Player | Operator | Feedback | Passer-by |
|---|:--:|:--:|:--:|:--:|
| Chip (status + door) | ✓ | ✓ | ✓ | ✓ |
| Sound → Keyboard voices/FX | ✓ | | | |
| Sound → Rendered voices + trim | ✓ | | | |
| MIDI → hardware / Connect / BT | (✓)¹ | ✓ | | |
| MIDI → Display / screen-off | ✓ | ✓ | | |
| MIDI → monitor + test outputs | | ✓ | | |
| Feedback → record | ✓ | ✓ | ✓ | |
| Footer → Restart audio | ✓ | ✓ | | |
| Footer → Reload app | | ✓ | | |

¹ *A player needs B1 (reconnect) when sound dies, but has no reason to know it lives under "MIDI."*

The panel is **~60% technician tool, ~40% player tool**, presented as one flat, three-tab surface with no visual or hierarchical distinction between "things a kid should touch" and "things that will fire raw MIDI at the hardware." The Sound tab is player-first (good — it's the default). Everything else is operator-first, wearing the same chrome.

---

## 4. Intent tensions — where the stories collide or go half-served

These are *user-intent* problems, not bugs. They are places where the panel's implied promise and the user's actual mental model diverge.

### T1. One door, two audiences, no seam
The everyday "change my sound" story (A1–A4) and the operator "debug/recover" stories (B1–B6) share the same entrance, the same three-tab bar, and equal prominence. A child two taps from **Panic**, **Local Off**, and **Reload app** is a persona-collision, not a feature. Best-in-class instrument UIs separate "play settings" from "system/service settings" — often behind a long-press, a PIN, or a distinct "advanced" affordance. Here they are peers.

### T2. "Sound" is discoverable; "my piano is silent" is not
The single most common walk-up *failure* — no sound — is fixed under a tab named **MIDI**, a word the target player (family members, including children) does not map to "make the piano work." The recovery story (B1) is filed under the least legible label. Consider surfacing "reconnect" where the pain is felt (e.g. from the status chip when the dot is off), not only inside MIDI.

### T3. The chip's label fights its function
The chip says the *voice name*, is labeled *Settings*, and encodes *connection status*. Three meanings, one control. A user who wants "settings" sees "Grand Piano"; a user who wants "change the sound" sees the right thing by accident. The intent of the control is ambiguous at rest.

### T4. Two homes for "turn off the screen"
Screen-off is offered **both** in the Settings MIDI/Display section **and** in the user chip's "who's playing" prompt (`PianoUserChip.jsx:68`). Same action, two doorways, two mental contexts ("settings" vs. "I'm done playing"). Redundancy isn't fatal, but it signals the action has no natural home — it's an operator want bolted onto two player flows.

### T5. Two "pick a sound" lists stacked under one tab
When a hardware `device` is present, the Sound tab shows **Keyboard voices** (onboard, over MIDI) *and* a separate **Rendered voices** list (`PianoSettingsSheet.jsx:92-136`). Both answer "what does the piano sound like," via two mechanisms, stacked vertically. A player's intent is singular ("pick the sound"); the panel presents two parallel authorities with no explanation of which one "wins" or why both exist.

### T6. Screen-off and feedback are shelved under the wrong shelf
- **Turning off the screen** has nothing to do with MIDI; it lives under the MIDI tab because it's an "operator" chore.
- **Giving feedback** is not a *setting*; it's a tab because there was no other home for it.
Both are honest engineering placements, but from the user's map they are non-sequiturs. "Display/power" and "Help/feedback" are their own intents, not settings sub-items.

### T7. The panel offers "Reload app" but sound choices don't survive it
The panel invites the player to curate a voice, gain, and reverb (A1–A4), and — in the same footer — offers **Reload app** (B6), which discards those choices back to defaults (voice state is session-scoped; `usePianoPreferences.js` exists but the sound sheet doesn't persist through it). The two stories quietly contradict: "make it yours" and "throw it away" are one tap apart, and nothing tells the user their careful tuning is ephemeral. Worth deciding: should a player's chosen voice/tone *stick* across reloads and sessions, or is it always a fresh start? Today the answer is implicitly "fresh start," but the UI implies permanence.

### T8. Recovery hammers aren't ranked for the user
**Restart audio & MIDI** (surgical) and **Reload app** (nuclear) sit side by side, same weight, same icon (`repeat`), no guidance on which to try first. The user's intent — "just make it work again" — isn't guided toward the lighter fix before the heavier one.

---

## 5. The user-story catalog (summary)

| # | As a… | I want to… | So that… | Served by | Health |
|---|---|---|---|---|---|
| A1 | Player | change the instrument voice | it sounds how I want | Sound → Keyboard voices | Strong (default tab) |
| A2 | Player | add reverb/chorus | it sounds fuller | Sound → Keyboard FX | Strong, but jargon-typed |
| A3 | Player | use a richer rendered instrument | it sounds realistic | Sound → Rendered voices | Strong; T5 confusion |
| A4 | Player | trim a voice's level/reverb | it's balanced | Sound → Gain/Reverb sliders | Strong |
| B1 | Operator | reconnect the piano | sound comes back | MIDI → Connect / Bluetooth | Works; **hidden (T2)** |
| B2 | Operator | turn the screen off | avoid burn-in / go dark | MIDI → Display | Works; misfiled (T6), dual-homed (T4) |
| B3 | Operator | watch raw MIDI | confirm hardware is talking | MIDI → monitor | Strong (for its audience) |
| B4 | Operator | fire test MIDI / panic | poke & un-stick the piano | MIDI → outputs | Strong; **too close to players (T1)** |
| B5 | Anyone | recover a wedged audio path | keep playing | Footer → Restart audio | Works; unranked (T8) |
| B6 | Operator | hard-reload the kiosk | clear a bad state | Footer → Reload app | Works; contradicts A1–A4 (T7) |
| C1 | Anyone | report a bug/idea by voice | it gets fixed | Feedback → Record | Strong; misfiled as a "setting" (T6) |
| D1 | Passer-by | see status at a glance | know it's working | Chip dot + label | Strong; overloaded (T3) |

---

## 6. The one decision worth making first

Everything in §4 reduces to a single unmade product decision:

> **Is this a player's sound panel that happens to hide an operator toolbox, or an operator's console that happens to let players pick a voice?**

Right now it is neither and both. Naming that — and drawing a seam between the two audiences (long-press / PIN / an "Advanced" divider, and moving "change the sound" and "reconnect the piano" to where players actually look) — would resolve T1, T2, T3, and T6 in one stroke, without touching a single one of the stories the panel already serves well.

---

*This audit documents intent and journeys only. Correctness, persistence mechanics, and code structure are out of scope and noted (T7) only where they change what the user experiences.*
