# Retire `media/apps/`

## Decision

`media/apps/` is an implementation-owned catch-all. Retire it as a filesystem
root; do **not** change either the `#apps/` source-code alias or `data/**/apps/`
user-state paths in this migration.

The replacement uses three explicit placement rules:

1. `media/_inbox/<domain>/` holds unreviewed source material.
2. `media/<domain>/` holds assets and accumulated output owned by one domain.
3. `media/<kind>/<domain>/` holds a cross-domain library where one mechanism
   owns the kind (for example audio or MIDI).

## Target layout

| Current | Target | Classification |
|---|---|---|
| `apps/school/curriculum/_inbox/` | `_inbox/school-curriculum/` | source intake |
| `apps/school/language/glossika-korean/` | `audio/language/glossika-korean/` | reusable language audio and learner recordings |
| `apps/school/Glossika/` | `_inbox/language/glossika-source/` | legacy/source corpus pending a focused import workflow |
| `apps/school/reading/books/` | `library/books/` | durable reading library |
| `apps/fitness/sessions/` | `fitness/sessions/` | fitness-owned session screenshots and manifests |
| `apps/fitness/_trash/` | `fitness/_trash/` | recoverable, retention-managed fitness frames |
| `apps/fitness/households/sessions/` | `fitness/sessions-legacy/` | pre-current-layout session corpus; preserve separately |
| `apps/fitness/ux/` | `fitness/ux/` | fitness-owned static UX assets |
| `apps/piano/log/` | `midi/piano/log/` | MIDI library source for the piano renderer |
| `apps/gameshow/` | `games/gameshow/` | game-show-owned static content |
| `apps/jeopardy/` | retired | empty directory |

`apps/school/curriculum/{civilization,culture,english,math,science}` are empty
and retire with their parent. The plan does not merge `sessions-legacy` into
current fitness sessions: their layout predates the current writer and must not
silently collide with live session IDs.

## Impact assessment

| Domain | Runtime impact | Required code changes |
|---|---|---|
| School curriculum intake | No runtime reader found | Documentation and authoring-path updates only |
| Language study | `YamlLanguageStudyDatastore` and `glossika` CLI build the media path | Replace the `apps/school/language` prefix; update path comments/tests |
| Fitness sessions | Writers, readers, API-relative paths, split CLI, and retention sweep use the old root | Change all root construction together; preserve API-relative path consistency; migrate live and legacy trees separately |
| Fitness UX | The menu-music endpoint emits a media-relative URL | Change emitted URL and source directory together |
| Piano MIDI | Scheduled renderer, MIDI library, and JamCorder archive use the old root | Change all three composition/adapter roots atomically; retain audio output at `audio/piano` |
| Game Show | Router receives `media/apps` as a broad serving root | Narrow it to `games/gameshow`; update routing tests |
| Config helper | `getHouseholdAppMediaPath()` has no production caller | Remove it after callers/tests confirm no need |

## Migration sequence

1. Add this plan and path-focused tests for each active domain.
2. Change code to resolve the target roots, while the old files remain in place.
3. Move one domain at a time with a pre-move manifest (file count and aggregate
   byte total), then run that domain's tests and a filesystem verification.
4. For fitness, move `sessions`, `_trash`, and `ux` independently; retain
   `sessions-legacy` as a separately named corpus.
5. For piano, pause the scheduled harvester or run the move during a quiet
   window, then verify that a MIDI source is discoverable and its MP3 output
   remains addressable.
6. Remove the empty `media/apps/` root only after the global path audit returns
   no production references and every moved manifest matches.

## Exit criteria

- `media/apps/` no longer exists.
- Every planned source tree is present at its target, with the same file count
  and aggregate byte total as before its move.
- A repository search has no production `media/apps` or `apps/<domain>` media
  path references. Historical documentation may retain them only when clearly
  marked historical.
- Unit tests pass for language-study paths, fitness session persistence and
  retention, piano MIDI discovery/rendering, and Game Show media containment.
- Smoke checks succeed: language audio plays and records; fitness can create and
  recap a session; piano discovers a MIDI source; Game Show serves a contained
  asset; school curriculum authoring can locate its new intake folder.
- `ConfigService.getHouseholdAppMediaPath()` is removed or has an explicitly
  documented non-`apps` replacement with a production caller.

## Rollback

Each move is a same-volume rename. If a domain check fails, move only that
domain's target directory back to its original location and restore its previous
path constant. Do not roll back completed, independently verified domains.
