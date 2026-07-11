# Piano Kiosk Settings — Rip-and-Replace Design

**Date:** 2026-07-11
**Status:** Design (validated in brainstorming; ready for implementation planning)
**Supersedes:** the current `PianoSettingsSheet.jsx` + `PianoChrome.jsx` settings surface
**Grounded in:** `docs/_wip/audits/2026-07-11-piano-kiosk-settings-user-story-audit.md`

> This is a **from-scratch rebuild**. We deliberately do not anchor to the current
> layout, tab organization, or panel structure. The audit named the problem; this
> design answers it.

---

## 1. The decision the audit demanded

The audit (§6) reduced everything to one unmade product decision:

> *Is this a player's sound panel that hides an operator toolbox, or an operator's console that lets players pick a voice?*

**Answer: it is a player's sound panel. The operator toolbox is hidden behind a seam.**

Every structural choice below follows from that.

---

## 2. Locked decisions (from brainstorming)

1. **Player-first surface; operator hidden.** Default surface is 100% player (sound/voice/tone). Operator tools live behind a **long-press hidden hotspot** — no PIN, fast for the operator, non-obvious to a child.
2. **One sound engine: the onboard Roland MDG-400.** Rendered / voice-bridge instruments are **removed from the surface and stubbed out**. There is no player-facing rendered-voice path in this rebuild.
3. **Full-state MIDI burst.** MIDI is fire-and-forget and the piano's live state is not detectably retained. Every change re-asserts the **entire** bundle, never a lone delta.
4. **Per-user saved presets.** Each user saves a full sound bundle as their default (plus a short favorites list). Selecting a user **auto-fires** their bundle.
5. **Voice-browse funnel:** per-user Favorites (top ~5) → curated house shortlist (your YAML, deduped) → grouped remainder (the full ~138 by family).
6. **Two independent chips.** "Who's playing" and "sound" remain visually separate doors, but selecting a user drives sound (auto-apply).
7. **Reuse existing tone interfaces.** Reverb / chorus / volume send paths already exist; the rebuild reorganizes their UI, not their transport.

---

## 3. Architecture: two doors, one seam

```
┌─ chrome (top-right) ──────────────────────────────────────┐
│  [ who's-playing chip ]        [ sound chip ● Voice Name ] │
└───────────────────────────────────────────────────────────┘
        │ tap                          │ tap            │ long-press
        ▼                              ▼                ▼
  Who's-playing               PLAYER SOUND PANEL   OPERATOR DRAWER
  (existing flow;             - Favorites (top 5)  - Connect / Bluetooth
   selecting a user           - House shortlist    - MIDI monitor
   auto-fires their           - Grouped voices     - Test: PC / Local / Panic
   preset bundle)             - Tone: reverb /     - Screen off (maintenance)
                                chorus / volume    - Restart audio & MIDI  ← try first
                              - Save as my default - Reload app             ← nuclear
                              - Add to favorites
```

- **Tap the sound chip → Player Sound Panel.** Nothing destructive is reachable here.
- **Long-press the sound chip → Operator Drawer.** The maintenance console, off a child's path.
- The two chips stay independent surfaces; the only coupling is behavioral (user-select → `applyBundle`).

This collapses audit tensions **T1** (one door, two audiences), **T3** (overloaded chip), and — via §8 — **T2**, **T4**, **T6**.

---

## 4. Player Sound Panel

The only surface a family member sees. Three regions, top to bottom:

### 4a. Sound picker — the three-tier funnel

1. **Your Favorites (top ~5)** — big tiles, the front door. Sourced from the active user's `favorites`. Each favorite carries its **full tone** (voice + reverb + chorus + volume), so tapping one recalls the exact sound, not just the instrument.
2. **House shortlist** — a hand-picked set (8–12) configured by KC in `config/piano.yml → shortlist:`, **deduped** against the active user's favorites so nothing appears twice.
3. **Browse all** — the full grouped voice list (~138) by family (Piano, Strings, …), revealed on demand. This is the "explore everything" tier, not the default view.

Selecting any voice fires the full bundle (§5).

### 4b. Tone

Compact controls beneath the chosen sound — **reverb** (type + level), **chorus** (type + level), **volume**. Reuses the existing send interfaces. Each change re-asserts the full bundle (§5), so tone edits never drift out of sync with the piano.

### 4c. Save

- **Save as my default** → snapshot the current bundle into the active user's `default`.
- **Add to favorites** → append current bundle to `favorites` (dedup by voice + tone).

No MIDI jargon, no panic, no reload — none of it is reachable from here.

---

## 5. Sound engine & the full-state burst

`PianoSoundContext` collapses to a **single authority**: the onboard device's grouped voices + reverb/chorus/volume over MIDI OUT. The rendered-voice layer (`usePianoVoiceBridge`, `instruments`, rendered cards, `bridge.*` calls) is stubbed/removed. This deletes audit **T5** (two stacked "pick a sound" lists).

### The bundle — the complete state we own

| Dimension | MIDI |
|---|---|
| Voice | Program Change + Bank Select |
| Reverb | type CC + level CC |
| Chorus | type CC + level CC |
| Volume | master volume CC |

### `applyBundle(bundle)` — the one path

A single function emits the ordered sequence (PC/bank → reverb type/level → chorus type/level → volume). **Everything routes through it:**

- Player edits a voice or tone knob → `applyBundle(currentBundle)` (full re-assert, not a lone CC).
- A user is selected as who's-playing → `applyBundle(user.preset.default)`.
- Operator "Restart audio & MIDI" → `applyBundle(currentBundle)` after reconnect.

Today's `resync()` already does a recovery-time version of this; the rebuild promotes it from a recovery-only path to **the** path. Result: the "did my change actually land?" failure class disappears, and per-user auto-apply is trivially `applyBundle(preset)`.

---

## 6. Per-user presets & persistence

A preset is one saved bundle, owned by a user:

```yaml
# users/{id}/apps/piano/preset.yml
default:
  voice:   { pc: 0,  bank: 0, name: "Concert Grand" }
  reverb:  { type: 3, level: 72 }
  chorus:  { type: 0, level: 0, on: false }
  volume:  100
favorites:                       # funnel tier 1 (top ~5)
  - { voice: { pc: 16, bank: 0, name: "Upright" }, reverb: {...}, chorus: {...}, volume: 96 }
  - ...
```

- Favorites **carry full tone**, not just a voice — "Dad's warm upright" recalls his exact reverb.
- `default` is what auto-fires on user-select.
- **Guest / no preset:** if the selected user has no `default`, we **do not reset** the piano — the current sound stays; Save is still offered. (Graceful degrade.)

**House shortlist** (funnel tier 2) lives in the piano app config YAML (`config/piano.yml → shortlist:`), deduped against the active user's favorites.

**This resolves audit T7 directly:** a player's tuning survives reload and reboot because it lives in the user's file, not session state. "Reload app" no longer silently discards a careful setup.

> Note the config-path gotcha (per project memory): runtime loads `config/{app}.yml`, **not** `apps/{app}/config.yml`, and it is cached at startup — a shortlist edit needs a reload/restart to take effect.

---

## 7. Operator Drawer (behind long-press)

The maintenance console. Grouped and **ranked**, resolving audit **T8** (recovery hammers unranked):

- **Hardware** — connection status, Connect / reconnect, Bluetooth settings launcher.
- **Diagnostics** — live MIDI monitor (rolling note/CC/PC log).
- **Test outputs** — Program Change, Local On/Off, Panic. (Now safely out of a child's reach — resolves **T1**'s worst case.)
- **Display** — screen off (maintenance / burn-in / night).
- **Recovery**, explicitly ordered:
  1. **Restart audio & MIDI** — presented first, framed as *"try this first."* Reconnect + `applyBundle(current)`.
  2. **Reload app** — de-emphasized, framed as the nuclear option.

---

## 8. Chrome & chip redesign — and reconnect where the pain is

The sound chip shows, at rest: **connection dot + active voice name** (the passer-by glance story, audit D1). Interactions:

- **Tap** → Player Sound Panel.
- **Long-press** → Operator Drawer.

**The one operator action promoted to the player surface: reconnect.** When the connection dot is **off** (the single most common walk-up failure — "no sound"), the sound chip surfaces an inline **Reconnect** affordance right where the pain is felt. This resolves audit **T2** ("my piano is silent" was buried under a tab named *MIDI*) without dragging the rest of the operator toolbox into the player's view.

**Screen-off** (audit **T4**, dual-homed) gets one natural home: the **"I'm done" / who's-playing** flow keeps its screen-off (player intent: "I'm finished"), and the Operator Drawer keeps a maintenance screen-off. The standalone settings-tab duplicate is **deleted**.

**Feedback** (audit **T6**, "not a setting") moves out of the settings tabs into the **Operator Drawer**. (Decision: the feedback-giver in practice is an adult/operator; keeping it off the player surface preserves the player-first minimalism. Revisit if we want in-situ capture for anyone.)

---

## 9. What gets removed or stubbed

- Rendered / voice-bridge voice cards, `instruments` sources, per-instrument gain/reverb sliders → **removed from surface**; `usePianoVoiceBridge` stubbed behind a dead-code flag or deleted.
- The three-tab (Sound / MIDI / Feedback) sheet structure → **gone**; replaced by Player Panel + Operator Drawer.
- Duplicate screen-off in settings → **deleted** (one home each in "done" flow + operator).
- Overloaded single-chip-does-three-jobs semantics → **split** (tap vs. long-press; reconnect surfaced on disconnect).

---

## 10. Testing

- **`applyBundle` unit tests** — asserts the full ordered MIDI sequence is emitted for every trigger (voice change, tone change, user-select, recovery). This is the reliability core; it gets the most coverage.
- **Preset persistence tests** — save default / add favorite / dedup / load-on-select; graceful no-preset degrade.
- **Funnel dedup test** — house shortlist minus user favorites.
- **Seam test** — tap opens Player Panel; long-press opens Operator Drawer; nothing destructive reachable from Player Panel.
- **Reconnect-promotion test** — dot off → inline Reconnect visible on the chip; dot on → hidden.
- Existing Playwright piano flows updated to the new surface.

---

## 11. Deferred / revisit

- **Rendered voices** — out of scope now (nothing built yet). If/when the bridge path matures, it slots in as an engine behind `applyBundle`, not a second list.
- **Feedback for non-operators** — currently operator-only; revisit if in-situ capture for any family member is wanted.
- **Per-piano-keyed presets** — `preset.yml` is per-user; if a user plays multiple pianos with different voice maps, key presets by piano id.

---

## 12. Audit-tension scorecard

| Tension | Resolution |
|---|---|
| T1 one door, two audiences | Player Panel vs. Operator Drawer (long-press seam) |
| T2 silence-fix buried under "MIDI" | Reconnect surfaced inline on the chip when disconnected |
| T3 overloaded chip | Tap = sound, long-press = operator; dot+name at rest |
| T4 screen-off dual-homed | One home in "done" flow + one in operator; duplicate deleted |
| T5 two stacked sound lists | Single onboard engine; rendered removed |
| T6 screen-off/feedback misfiled | Screen-off → done/operator; feedback → operator |
| T7 choices don't survive reload | Per-user `preset.yml` persistence |
| T8 recovery hammers unranked | Restart-first, reload-nuclear ordering in drawer |
