# Piano MIDI → MP3 Conversion — Design

> A daily job that renders every piano `.mid` under
> `household/history/piano/` to a normalized MP3 mirrored at
> `media/audio/piano/<same relative path>.mp3`, following the recorder's
> established `synth → wav → ffmpeg-loudnorm → mp3` pattern. Date: 2026-07-12.

## Problem

`household/history/piano/` holds ~1169 `.mid` recordings — per-user practice
takes (`{user}/{YYYY-MM-DD}/*.mid`) and the JamCorder harvest tree
(`jamcorder/YYYY/YYYY-MM/YYYY-MM-DD HH.MM.SS.mid`). We want a listenable MP3 for
each, in `media/audio/piano/` mirroring the same tree, produced automatically on
a daily schedule.

## Prior art / toolchain

The MIDI recorder (on the piano's Mac) already converts with:
`timidity <mid> -Ow -o <wav>` → `ffmpeg -i <wav> -af loudnorm=I=-16:TP=-1.5:LRA=11
-codec:a libmp3lame -qscale:a 2 <mp3> -y` → delete WAV, skip if MP3 exists, sweep
pending. We follow that pattern on the server, with one substitution: **Alpine has
no `timidity`, so we use `fluidsynth` + the `soundfont-timgm` (TimGM6mb.sf2) GM
soundfont** — both are General-MIDI software synths. The WAV→MP3 loudnorm/quality
step is byte-for-byte identical to the recorder's. `ffmpeg` is already in the
image; `fluidsynth` + `soundfont-timgm` are added (`apk add`, authorized).

## Requirements

| Item | Decision |
|---|---|
| **Source** | All `.mid` under `household/history/piano/` (per-user + jamcorder), recursive |
| **Dest** | `media/audio/piano/<same relative path>.mp3` (exact mirror; `.mid`→`.mp3`) |
| **Synth** | `fluidsynth` + `soundfont-timgm` (TimGM6mb.sf2) |
| **Pipeline** | fluidsynth → scratch WAV → ffmpeg loudnorm → `.mp3.tmp` → rename final; delete WAV |
| **Dedup** | Skip if the final mirror `.mp3` already exists (resumable) |
| **Junk guardrail** | Skip a `.mid` only if it has NO notes, or is both long AND note-sparse (`durationSeconds > junkMinSeconds` (default 1800) AND `noteCount < junkMinNotes` (default 200)) — the signature of a genuinely stuck note / idle recording. A merely LONG file (real multi-hour practice session, tens of thousands of notes) is NOT junk and IS rendered. Duration + note count read cheaply from the SMF (pure `analyzeMidi`, no render) before fluidsynth. Configurable via `pianoaudio.junkMinSeconds` / `pianoaudio.junkMinNotes`. |
| **Order** | Newest-first |
| **Cadence** | Daily (`30 4 * * *`), after the 4am JamCorder harvest |
| **Backfill** | First run(s) drain the ~1169 backlog; drained in the deploy phase via repeated manual triggers |

## Architecture (layer-mapped, mirrors the JamCorder feature)

```
2_domains/pianoaudio/                          ── pure, no I/O
  pianoAudioPaths.mjs                           mp3RelForMidiRel(rel) → swap trailing .mid→.mp3, preserve subdirs

3_applications/pianoaudio/                     ── orchestration + ports (Decision D3)
  ports/IMidiLibrary.mjs                        listPending() → [{ midiPath, mp3Path }] (abs; already filtered to missing mp3)
  ports/IMidiConverter.mjs                      convert(midiPath, mp3Path) → Promise<void>
  ConvertPendingPianoMidi.mjs                   use case: listPending → convert each (per-file skip-on-error) → { count, status }

1_adapters/pianoaudio/                         ── I/O, extends its port
  FsMidiLibrary.mjs                             walk history/piano/**.mid, mirror → media/audio/piano/**.mp3,
                                                filter to missing mp3, newest-first (FileIO)
  FluidSynthMp3Converter.mjs                    fluidsynth → scratch WAV → ffmpeg loudnorm → .mp3.tmp → rename;
                                                rm WAV; injectable exec seam (execFile) for testability

1_adapters/harvester/other/PianoMp3Harvester.mjs   thin IHarvester (serviceId 'piano-mp3', category OTHER) → use case

5_composition/bootstrap.mjs                    wire + registerHarvester('piano-mp3', …)  (barrel export like jamcorder)
system/config/jobs.yml                         + { id: piano-mp3, name: 'Piano MIDI→MP3', schedule: '30 4 * * *', timeout: 1200000 }
docker/Dockerfile                              apk add fluidsynth soundfont-timgm
```

**Layer adherence:** domain pure (path string math only); the use case depends
only on the two ports (no adapter/fs imports); adapters `extends` their port and
own all I/O (FileIO + `node:child_process`); bootstrap is the sole construction
site and injects resolved paths (source/dest dirs, soundfont path, scratch dir).

## Per-file pipeline (exact)

1. `fluidsynth -ni -F <scratch>/<uniq>.wav -r 44100 <soundfontPath> <midiPath>`
   (`-n` no MIDI in, `-i` no shell, `-F` render-to-file, `-r` 44.1kHz).
2. `ffmpeg -i <scratch>/<uniq>.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -codec:a libmp3lame -qscale:a 2 -f mp3 <mp3Path>.tmp -y`
3. Rename `<mp3Path>.tmp` → `<mp3Path>` (atomic; crash never leaves a partial final mp3).
4. Delete the scratch WAV.

Skip the whole file if `<mp3Path>` already exists. Ensure the mp3's parent dir
exists before writing. Per-file timeouts scale with input size (fluidsynth ≈ by
midi size, ffmpeg ≈ by wav size), min 60s, max 600s — mirroring the recorder.

## Backfill, timeout & resumability

Dedup-by-final-mp3-exists makes each run **resumable**. The scheduler's `timeout`
(1,200,000 ms / 20 min → a few hundred files/run) is a non-cancelling race, so a
timed-out run keeps draining in the background; already-done files are skipped, so
the backlog drains and daily incremental runs finish fast. The use case is
**serialized** (an in-flight guard): a concurrent trigger while a drain is already
running returns `{count:0, status:'skipped', reason:'already-running'}` instead of
converting the same files a second time — this prevents two runs from racing on the
same output. Crash-safety: the scratch WAV name is per-conversion unique, and the
final mp3 is written to a stable `<mp3>.mp3.tmp` then atomically renamed, so a
killed conversion never leaves a partial final mp3; a SIGKILL-orphaned `.mp3.tmp`
keeps its stable name and is harmlessly overwritten (`ffmpeg -y`) the next time that
file is processed. Files are converted **newest-first**.

**Deploy-phase backfill:** after deploy, trigger
`POST /api/v1/scheduling/run/piano-mp3` repeatedly until it reports `pending: 0`,
draining the ~1169 backlog in one sitting.

## Error handling

- **Per-file** (fluidsynth/ffmpeg non-zero exit or timeout): log `pianoaudio.convert.failed`, skip that file, continue; only successes counted; scratch WAV/tmp cleaned; no partial media write.
- **Whole-run:** if the soundfont or a binary is missing, every file fails → logged; the run returns `{ count: 0, status: 'error' }`.
- No exception escapes the harvester's `harvest()` (the scheduler expects a `{count,status}` result).

## Config / paths

- Source base: `configService.getHouseholdPath('history/piano')`.
- Dest base: `configService.getMediaDir()` + `/audio/piano`.
- Soundfont path: injected, default the `soundfont-timgm` install path (confirmed at build; expected `/usr/share/soundfonts/TimGM6mb.sf2`), overridable.
- Scratch dir: a container tmp dir (e.g. `/tmp/pianoaudio`), created + swept per run.

## Testing (TDD, layer-aligned)

- **Domain:** `mp3RelForMidiRel` pure — `.mid`→`.mp3`, preserves nested dirs for both the jamcorder (`year/month/file`) and per-user (`user/date/file`) shapes; leaves non-`.mid` untouched / rejects.
- **Application:** `ConvertPendingPianoMidi` with a fake library (pending refs) + fake converter (records calls; one throws) — converts all pending, per-file error skipped-not-fatal, correct count/status; empty pending → `{count:0, status:'success'}`.
- **Adapters:** `FsMidiLibrary` against a temp tree (mix of `.mid` with/without mirror `.mp3`, nested dirs) → returns only the missing refs with correct mirror `mp3Path`, newest-first; `FluidSynthMp3Converter` with an **injected exec seam** → asserts the exact fluidsynth + ffmpeg argv vectors and the WAV→`.mp3.tmp`→rename→cleanup flow (real subprocess proven by the live deploy run).
- **Live:** deploy → drain → mp3 count matches midi count; spot-check a rendered mp3 has audio.

## Non-goals

- No re-encode of existing mp3s / no quality tiers (single loudnorm profile matching the recorder).
- No deletion of source `.mid` or of orphan mp3s whose `.mid` was removed (mirror is additive).
- No per-file metadata tagging (the mp3 is a rendered artifact; the `.mid` remains canonical).
- No multi-soundfont / per-instrument selection (single GM soundfont).
