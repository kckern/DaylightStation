# Fitness menu music ignores configured `menu_music.volume`

**Date:** 2026-06-17
**Area:** Fitness app — menu/browse ambient music
**Severity:** Minor (UX / loudness) — music plays ~5× louder than configured
**Status:** Fixed (2026-06-17) — volume-reactive effect added to `useMenuMusic.js`; both hardcoded `0.15` defaults lowered to `0.05`

## Summary

`data/household/config/fitness.yml` sets:

```yaml
menu_music:
  volume: 0.03
```

The value is plumbed end-to-end correctly, but in practice the menu music
frequently plays at the **hardcoded `0.15` default** instead of the configured
`0.03`. There is a race between when playback starts and when the configured
volume arrives, and **no mechanism re-applies the volume to an already-playing
track** once it changes.

## Data flow (all correct in isolation)

| Stage | Location | Notes |
|-------|----------|-------|
| Config file | `data/household/config/fitness.yml` → `menu_music.volume: 0.03` | Source of truth |
| Backend read | `backend/src/4_api/v1/routers/fitness.mjs:1302` | `fitnessConfig?.menu_music?.volume ?? 0.15` |
| API response | `GET /api/v1/fitness/menu-music` (`fitness.mjs:1285`) | `{ tracks, volume }` |
| Frontend fetch | `frontend/src/Apps/FitnessApp.jsx:1030-1034` | `setMenuMusicVolume(music.volume)`; `.catch(() => {})` silent |
| Initial state | `frontend/src/Apps/FitnessApp.jsx:58` | `useState(0.15)` — hardcoded default |
| Prop → hook | `frontend/src/modules/Fitness/nav/MenuMusicController.jsx` | passes `volume` to `useMenuMusic` |
| Apply to audio | `frontend/src/modules/Fitness/nav/useMenuMusic.js:102,154,187` | fades target `volumeRef.current` |

## Root cause

1. **Stale capture at fade-start.** The `isActive` start effect
   (`useMenuMusic.js:138`) reads `volumeRef.current` only at the moment it kicks
   off a fade, and it only depends on `[isActive]`. The configured `0.03`
   arrives asynchronously from the `/menu-music` fetch.

2. **No live re-apply on volume change.** The effect at `useMenuMusic.js:65`
   updates `volumeRef.current = volume` but does **not** re-trigger a fade on the
   currently-playing slot. There is no `useEffect(..., [volume])` that adjusts
   live playback.

3. **Result:** if menu music starts playing before the fetch resolves (the
   common case — initial state is `0.15`), it fades to `0.15` and stays there.
   The new `0.03` is only honored on the *next* crossfade (track change / track
   end), when a fresh fade reads the updated `volumeRef`.

4. **Secondary path:** the fetch is silently caught (`.catch(() => {})`) and
   both the frontend init and backend fallback are `0.15`, so any failure or
   latency lands on the loud default.

## Proposed fix

Add a volume-reactive effect to `useMenuMusic.js` that live-applies the value to
whichever slot is currently playing:

```js
// Live-apply volume changes to the currently-playing slot
useEffect(() => {
  if (!hasStarted.current || !isActiveRef.current) return;
  const audio = getSlot(activeSlot.current);
  if (audio && !audio.paused) {
    startFade(audio, audio.volume, volume, FADE_MS, getFadeHandle(activeSlot.current), null);
  }
}, [volume]);
```

This closes the race regardless of whether the fetch resolves before or after
playback starts. Keep the `volumeRef.current = volume` line so subsequent fades
also use the latest value.

## Notes / caveats

- The FitnessApp runs in **Firefox `--kiosk` on the garage box**, where
  audible autoplay is gated until a user gesture (see `CLAUDE.local.md` and
  memory `reference_fitness_audio_cue_playback`). That is a *separate* "music
  doesn't start at all" concern — distinct from this "starts at the wrong
  volume" bug. Verify cues/music actually play on the kiosk before assuming the
  volume fix is observable there.
- Consider also lowering the two hardcoded `0.15` defaults (frontend init +
  backend fallback) so a fetch failure degrades quieter rather than louder.

## Verification plan

1. Reproduce: load fitness browse screen, confirm menu music audibly louder than
   `0.03` despite config.
2. Apply the `[volume]` effect.
3. Confirm via `menu-music.*` log events + audible level that playback settles
   to the configured value within one `FADE_MS` window after the fetch resolves.
