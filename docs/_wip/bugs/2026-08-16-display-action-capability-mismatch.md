# Display action on a playable-only source renders a blank frame

**Date:** 2026-08-16
**Symptom:** On `/screens/living-room`, an FHE menu tile opened to an empty frame. No error on screen, none in the console, none in the backend log.

## Root cause

The list row paired an action with a source that cannot perform it.

```yaml
# data/household/config/lists/menus/fhe.yml
- uid: 019b436a-f458-711a-9517-32fca72b7dff
  input: files:art/fhe/esther.jpg
  action: Display
  label: test-user
```

`ListAdapter` turns `action: Display` into a `display` action key. `MenuStack.jsx:127`
routes that to `<Displayer>`, which renders `<img src={data.imageUrl}>` from
`/api/v1/info/files/art/fhe/esther.jpg`. That response carried no `imageUrl`, so
the `src` was `undefined` and the `<img>` painted nothing.

The file was never the problem — it streamed fine at 1,086,833 bytes. The
adapter was:

| id | capabilities |
|---|---|
| `files:art/fhe/esther.jpg` | `playable` |
| `canvas:fhe/esther.jpg` | `displayable` |

Same bytes. The canvas root defaults to `<media>/img/art` (`app.mjs:873`), which
sits inside the `files` root, so one picture has two ids with different
capabilities — and only one of them answers `Display`.

Contributing factor: the deployed backend predated commit `4bc2ddbb0`, which
added `imageUrl` for image files in `FileAdapter`. The prod tree was 268 commits
behind `origin/main`. On a current build the row would have worked, which is
exactly why the failure was so quiet — it depended on which build was running.

## Why nothing caught it

- `Displayer` read a single field (`imageUrl`) and rendered a blank `<img>` when
  it was absent, indistinguishable from a slow load.
- The admin's Display preview (`ListsItemRow.jsx:501`) uses the *same*
  `Displayer`, so it reproduced the identical blank box — the one place you would
  look to check your work agreed with the broken screen.
- Nothing compared a row's `action` against its content's `capabilities`, even
  though `/api/v1/info` already returns them.

## Fix

Immediate (config, no deploy): `input: canvas:fhe/esther.jpg`. `ListAdapter`
caches lists by mtime, so it took effect without a restart.

Structural, in three layers:

1. **`Displayer` fallback** — resolve `imageUrl → image → thumbnail → mediaUrl`
   (the last for image payloads only; a video's `mediaUrl` is a stream and an
   `<img>` pointed at it shows a broken icon). When nothing resolves, render a
   named error instead of an empty frame.
2. **Adapter path identity** — `resolveFilePath(localId)` and
   `localIdForFilePath(absPath)` on the filesystem-backed adapters, feeding
   `ContentAlternatesService` and `GET /api/v1/content/alternates/:source/*`.
3. **Admin warning** — `CapabilityWarning` on each list row compares the action
   against the resolved capabilities and offers the equivalent id as a one-click
   swap.

## Design note: the warning must stay quiet

A warning that fires on healthy rows gets ignored, and then it protects nothing.
`capabilityMismatch` returns null for anything uncertain:

- unknown or empty capabilities ("cannot judge", never "broken")
- an action with no trustworthy rule
- while the lookup is in flight
- when the lookup failed

`Read` is deliberately excluded from `ACTION_CAPABILITIES`: no adapter emits
`readable` (readalong reports `playable`/`displayable`), so requiring it would
flag every Read row. `Queue` accepts `playable` as well as `queueable`, because
only containers report the latter.

Capabilities verified against live adapters:

| source | capabilities |
|---|---|
| plex episode | `playable`, `displayable` |
| singalong hymn | `playable`, `displayable` |
| files (video) | `playable`, `displayable` |
| files (image) | `playable` |
| canvas (image) | `displayable` |
| art preset | `displayable` |
| menu / watchlist / program | `displayable`, `listable`, `queueable` |
| app | `openable` |
