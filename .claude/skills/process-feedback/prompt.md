---
name: process-feedback
description: Turn collected voice-feedback inbox items into actionable bug/audit docs in docs/_wip/, then mark each item filed
---

# Process Feedback

Drain the app-wide voice-feedback inbox: read each captured note, turn it into one
or more **actionable, spec-ready docs** under `docs/_wip/bugs/` or
`docs/_wip/audits/`, then mark the inbox item **filed** with a pointer back to what
you created. The goal is that every raw feedback item ends up as a concrete unit of
work ready for `/brainstorm` (spec) or a plan, and the inbox returns to empty.

Feedback comes from the in-app Feedback panel (`frontend/src/modules/Feedback/`):
the user records a spoken note, it's transcribed by Whisper, and stored per app.
See [[reference_feedback_system_and_kiosk_mic]].

## Inputs

- `app` (optional): only process this app's items (e.g. `piano`). Default: all apps.
- `--dry-run` (optional): do everything EXCEPT writing docs or PATCHing the inbox —
  print the plan instead, for review.

## The inbox API (backend on localhost)

```bash
PORT=3111   # this host; adjust if your dev backend is on another port (system.yml SSOT)
# List NEW items (the work queue). Items with status != "new" are already handled.
curl -s "http://localhost:$PORT/api/v1/feedback"        # all apps
curl -s "http://localhost:$PORT/api/v1/feedback?app=piano"
# Full item (transcript + context.route + logs snapshot/pointer):
curl -s "http://localhost:$PORT/api/v1/feedback/<app>/<id>"
# Mark filed (do this LAST, only after the doc(s) exist):
curl -s -X PATCH "http://localhost:$PORT/api/v1/feedback/<app>/<id>" \
  -H 'Content-Type: application/json' \
  -d '{"status":"filed","notes":"docs/_wip/bugs/2026-06-24-piano-... .md; docs/_wip/audits/2026-06-24-piano-... .md"}'
```

The audio lives at `media/audio/feedback/<app>/<id>.webm` (read via `sudo docker exec
daylight-station sh -c 'cat ...'` if you need to re-listen; usually the transcript is
enough). The item's `logs.recent` is a snapshot of the client log events around the
report; `logs.appLogDir` points at the persisted session log for deeper detail.

## Procedure

1. **Pull the queue.** List items (filter to `status: new`; honor the `app` arg). If
   the inbox is empty, say so and stop. Announce how many you'll process.

2. **For each item, fetch the full record** and read the transcript, `context.route`,
   and the log snapshot.

3. **Decompose into distinct concerns.** A single spoken note often contains several
   separable asks — e.g. one broken thing PLUS a couple of improvements PLUS a feature
   idea. Split them. Group only tightly-coupled points into one doc.

4. **Classify each concern, then write a doc** (one per concern, or per tight group):
   - **Bug** — something broken, wrong, or regressed → `docs/_wip/bugs/`.
   - **Improvement / UX / refactor / new feature / idea** → `docs/_wip/audits/`.
   - Filename: `YYYY-MM-DD-<app>-<kebab-slug>.md`, where the date is the feedback
     item's `created` date (traceability to when it was reported) and the slug is a
     short topic (e.g. `piano-studio-staff-bar-styling`).
   - Follow CLAUDE.md doc rules: `_wip/` subfolder, date-prefixed, **no instance
     -specific values** (hosts/ports/paths → placeholders).

5. **Mark the item filed** via PATCH with `status: "filed"` and `notes` listing every
   doc path you created from it. Never `DELETE` — we keep the audio + record. Do this
   only after the docs are written (skip under `--dry-run`).

6. **Summarize**: a table of `feedback id → docs created (bug/audit) → filed`, and
   note anything ambiguous you classified by judgment so the user can re-file it.

## Doc template

Each doc must be self-sufficient input for a spec or plan — someone should be able to
`/brainstorm` or write a plan from it without re-listening to the audio.

```markdown
# <Concise title of the concern>

- **Source:** voice feedback `<app>/<id>` · route `<context.route>` · reported `<created>`
- **Audio:** `media/audio/feedback/<app>/<id>.webm`
- **Type:** bug | improvement | feature
- **Area:** <subsystem, e.g. Piano Studio / Lessons>

## What the user said
> <the relevant verbatim slice of the transcript for THIS concern>

## Problem / opportunity
<1–3 sentences distilling it in your own words: current behavior vs desired.>

## Desired outcome
<What "done" looks like, concretely. For a feature, the intended UX.>

## Actionable tasks
- [ ] <task>
- [ ] <task>

## Acceptance criteria
- <observable, testable condition>

## Where to look
<Best-guess affected files/components from the route + your codebase knowledge,
e.g. `frontend/src/modules/Piano/PianoKiosk/modes/Studio/...`. Don't over-investigate;
a pointer is enough — the spec/plan phase digs in.>

## Context / evidence
<Anything from `logs.recent` relevant to a bug (errors, timestamps), or `null` if N/A.
Pointer for more: `logs.appLogDir`.>
```

## Notes

- Be faithful to the user's intent — quote the transcript, don't editorialize away
  their idea. If they proposed a specific design (e.g. "a triptych with a circle of
  fifths"), capture it as the desired UX, not a vague "improve layout".
- One feedback item legitimately fans out to multiple docs across both folders.
- Keep titles and slugs specific (`...staff-bar-not-black`, not `...studio-styling`).
- After filing, re-list the inbox to confirm it's drained (only `filed` items remain).
```
