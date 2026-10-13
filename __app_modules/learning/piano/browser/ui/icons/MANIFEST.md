# Piano UI Icons — Solar (Bold) via Iconify

Source: [Solar icon set](https://icon-sets.iconify.design/solar/) (MIT, by 480 Design) via Iconify API.
All SVGs use `fill="currentColor"` — set color via CSS `color:`.

| Group | Concept | File | Solar name |
|-------|---------|------|------------|
| menu | video | `menu/video.svg` | solar:videocamera-record-bold |
| menu | music | `menu/music.svg` | solar:music-note-2-bold |
| menu | sheet-music | `menu/sheet-music.svg` | solar:notes-bold |
| menu | game | `menu/game.svg` | solar:gamepad-bold |
| menu | lessons | `menu/lessons.svg` | solar:square-academic-cap-2-bold |
| menu | studio | `studio.svg` | grand-piano glyph — NOT a microphone. Was solar:microphone-bold; swapped for a solid grand piano in an earlier commit. The mic is `singalong`. |
| menu | instruments | `menu/instruments.svg` | solar:tuning-2-bold (faders) |
| menu | composers | `menu/composers.svg` | solar:book-2-bold (open book) |
| menu | singalong | `singalong.svg` | solar:microphone-large-bold (handheld karaoke mic) |
| menu | metronome | `metronome.svg` | svgrepo 390025 metronome (Training) — not Solar; normalized to 1em/currentColor |
| menu | quill | `quill.svg` | quill/feather pen (Composer) — not Solar |
| chrome | home | `chrome/home.svg` | solar:home-2-bold |
| chrome | connection | `chrome/connection.svg` | solar:bluetooth-square-bold |
| transport | play | `transport/play.svg` | solar:play-bold |
| transport | pause | `transport/pause.svg` | solar:pause-bold |
| transport | previous | `transport/previous.svg` | solar:skip-previous-bold |
| transport | next | `transport/next.svg` | solar:skip-next-bold |
| transport | shuffle | `transport/shuffle.svg` | solar:shuffle-bold |
| transport | repeat | `transport/repeat.svg` | solar:repeat-bold |
| transport | volume-down | `transport/volume-down.svg` | solar:volume-small-bold |
| transport | volume-up | `transport/volume-up.svg` | solar:volume-loud-bold |
| transport | queue | `transport/queue.svg` | solar:playlist-2-bold |
| transport | back | `transport/back.svg` | solar:alt-arrow-left-bold |
| transport | close | `transport/close.svg` | solar:close-circle-bold |
| video | skip-back-30 | `video/skip-back-30.svg` | solar:rewind-back-bold |
| video | skip-back-15 | `video/skip-back-15.svg` | solar:alt-arrow-left-bold (single chevron) |
| video | skip-forward-15 | `video/skip-forward-15.svg` | solar:alt-arrow-left-bold, mirrored |
| video | skip-forward-30 | `video/skip-forward-30.svg` | solar:rewind-forward-bold |
| video | speed | `video/speed.svg` | solar:playback-speed-bold |
| video | loop-in | `video/loop-in.svg` | svgrepo "in" (arrow into bracket) — not Solar; normalized to 1em/currentColor |
| video | loop-out | `video/loop-out.svg` | same glyph as `loop-in`, mirrored horizontally |
| video | loop-toggle | `video/loop-toggle.svg` | svgrepo "loop-1" — STROKED, not Solar; `stroke="currentColor"`, `fill="none"` |
| video | clear-loop | `video/clear-loop.svg` | svgrepo "clear-circle" (X in circle) — STROKED, same treatment |
| video | play-along | `video/play-along.svg` | solar:keyboard-bold |
| studio | record | `studio/record.svg` | solar:record-bold |
| studio | stop | `studio/stop.svg` | solar:stop-bold |
| studio | trash | `studio/trash.svg` | solar:trash-bin-trash-bold |
| family | family-keys | `family-keys.svg` | SVG Repo 13825 accordion (pack music-3) — not Solar; normalized to 1em/currentColor |
| family | family-guitar | `family-guitar.svg` | SVG Repo 23347 acoustic-guitar (pack music-control-panel) — not Solar; normalized to 1em/currentColor |
| family | family-strings | `family-strings.svg` | SVG Repo 3260 violin (pack musical-instruments-gallery) — not Solar; normalized to 1em/currentColor |
| family | family-winds | `family-winds.svg` | SVG Repo 510290 trumpet (Zest Interface Icons, MIT) — not Solar; normalized to 1em/currentColor |
| family | family-synths | `family-synths.svg` | solar:soundwave-bold |
| family | family-world | `family-world.svg` | solar:global-bold |
| family | family-fun | `family-fun.svg` | SVG Repo 33972 drum (pack carnival-fill) — not Solar; normalized to 1em/currentColor |
| family | star | `star.svg` | solar:star-bold |

## Notes
- **family-\*** are the Sound sheet rail glyphs (`PianoKiosk/voiceFamilies.js`); `pianos` reuses `piano` and `voices` reuses `singalong` (the mic; `studio` is a grand piano). Solar has no guitar/violin/trumpet/drum/accordion, so those four plus the accordion come from SVG Repo, stripped of the XML prolog, fixed 800px size and `#000000` fills, and given `width="1em" height="1em" fill="currentColor"` on the root. `instrumentIcon.js` maps voice names onto the same names.
- **skip-back/forward-30** use the DOUBLE-chevron `rewind-back` / `rewind-forward` glyph; **skip-back/forward-15** use a SINGLE chevron (`alt-arrow`, mirrored for forward). The chevron count encodes the step size; the video chrome renders the 15/30 numeral beside it. Do not re-unify these four — identical glyphs is exactly the bug this replaced.
- **loop-in / loop-out** are the loop's start and end marks. They are the SAME glyph, mirrored — `loop-out.svg` wraps the path in `translate(32 0) scale(-1 1)`. Editing one means editing both. They deliberately do NOT use a circular-arrow glyph: in the video chrome, a circle means "looping", and only the loop toggle (`repeat`) gets one.
- **loop-toggle / clear-loop** are STROKE icons (`stroke="currentColor"`, `fill="none"`) in an otherwise filled set. The video chrome sizes them to 1.25em so they don't read lighter than the filled brackets beside them — if you swap in a filled glyph, drop that rule.
- **loop-toggle** is separate from **repeat** on purpose: `repeat` means "repeat the track" (MusicPlayer, OperatorDrawer), `loop-toggle` means "cycle the A–B region". Don't collapse them.
- **play-along** uses `keyboard` (Solar has no piano-keyboard glyph).
- **connection** uses `bluetooth-square` (matches the BLE-MIDI link).
- **record** is a filled circle (`record`); pairs with **stop** (filled square).

- **game-battle-stadium** is the one glyph NOT from the Solar set: the Battle Stadium pokeball (SVG Repo 420929), recolored to `currentColor` and sized `1em` to sit in the tile grid with the rest.
