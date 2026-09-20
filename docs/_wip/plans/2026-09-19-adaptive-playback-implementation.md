# Adaptive Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone in the household can press Play on available media and watch it reliably, without troubleshooting formats, devices, or providers.

**Architecture:** Pure content-domain policies choose renditions and recovery actions. Application-owned ports coordinate provider adapters, durable attempt ownership, capacity, and optional preparation. Provider details remain under `backend/src/1_adapters/`; renderers report observations and perform native adaptive streaming.

**Tech Stack:** Node >=22.13.0, existing ES modules/React, Vitest, Playwright, existing YAML/FileIO infrastructure, FFmpeg/ffprobe behind process adapters, existing DASH and HLS renderers. No additional runtime dependency is assumed.

**Spec:** [Adaptive playback design](2026-09-19-adaptive-playback-design.md).

## Global Constraints

- All Plex-specific mechanics belong in `backend/src/1_adapters/`.
- Dependencies point inward according to `docs/reference/core/layers-of-abstraction/ddd-reference.md`.
- Content is level 1; it cannot import level-2 media entities.
- Preserve originals; managed derivatives are reproducible and separately retained.
- One authoritative attempt per playback intent; separate viewers and composite slots are independent.
- Reporting success does not prove playback or release resources.
- Start ordinary playback optimistically; no mandatory assessment, probe or preparation on Play. Missing metadata alone does not trigger assessment.
- Assess known-risk video matches, the second distinct unexpected interruption in 120 seconds, or a definitive incompatibility. Seed HEVC/VP9/AV1 at width >=1920 OR height >=1080 using already-available metadata.
- Audio-only playback bypasses video screening/preparation; retain lightweight health and access recovery.
- One episode starts after >=1 second without expected progress and closes after five healthy seconds. Ignore intentional pauses, bounded seek warmup and suspension; retain first-stall/startup timeout.
- Learning is scoped and evidence-based; network or unknown-cause failures cannot become codec rules. Promotion and expiry follow the design's explicit thresholds.
- Unknown capability/health is not success or permission for unbounded work.
- Three replacement attempts per incident; reset only after 60 seconds healthy playback; at most six replacements per rolling ten minutes.
- Initial release criteria: prepared LAN startup <=5 seconds; 30 minutes or full shorter item without unexpected rebuffering; one full-length film; recover or explain state within 30 seconds of detection.
- VOD recovery position tolerance: two seconds or one declared segment duration, whichever is greater.
- Use structured logging; never log signed URLs or tokens.
- Never launch a second live household backend for tests. Use isolated injected dependencies or the one existing approved stack.
- No bulk preparation until quota and free-space reserve are configured. No restart, codec toggle, or fleet reload during active household playback.

## Review Focus

- Open succeeds after cancellation or process death: reconcile and close that owned resource, never another viewer's (A3/A4).
- A few advancing frames between stalls: do not reset the recovery budget (A1/A5).
- A file changes in place during preparation: never publish the old derivative as current (B1/B3).
- Selected audio/subtitles or HDR semantics disappear in fallback: reject that candidate or explain the limitation (A1/B2).
- Close times out while another request needs capacity: keep uncertain work reserved and avoid oversubscription (A3/A4).

## Execution map

This scope contains three independently reviewable deliveries, with shared contracts:

| Order | Plan | Working deliverable |
|---|---|---|
| 1 | [A — Playback control](2026-09-19-adaptive-playback-a-control.md) | Sustainable selection, owned attempts, bounded recovery, live player integration |
| 2 | [B — Media preparation](2026-09-19-adaptive-playback-b-preparation.md) | Durable preparation and validated adaptive derivatives with storage management |
| 3 | [C — Fleet acceptance](2026-09-19-adaptive-playback-c-acceptance.md) | Enabled-provider coverage, fault tests, actual-device evidence and controlled rollout |

A alone does not fulfill the full goal. B alone does not fulfill it. Complete C
against the actual deployed build before the goal can be marked complete.

## Prerequisite: authoritative baseline

- [ ] Read CLAUDE.md, CLAUDE.local.md, the spec, and the DDD reference. Inspect local and deployed git status/HEAD, fetch origin and the current deployed branch, then create an isolated execution worktree from the reconciled source using the worktree skill. Preserve unrelated edits.
- [ ] Verify the running container build identifier separately from deploy-tree HEAD. Record both in `docs/_wip/audits/2026-09-19-adaptive-playback-baseline.md` without hostnames, credentials, household identifiers or absolute infrastructure paths.
- [ ] Run `npm run audit:layers` and `npm run check:parse`; record pre-existing failures separately. Re-read any changed integration seams before editing.
- [ ] Inventory configured video/audio sources and actual household renderers through configuration and read-only device inspection. Record supported semantic operations, actual observation fields, and evidence gaps. A source missing from this inventory cannot silently count as covered.
- [ ] Capture one controlled baseline stream per provider class, including client buffer/decoded progress, provider output speed where available, process/resource counts and cleanup behavior. Use existing sessions read-only when occupied; schedule disruptive probes only when idle.

## Verification commands and commit discipline

New unit/application tests are colocated `*.test.mjs` with `// @vitest-environment node`.
Frontend integration tests are colocated `*.test.jsx`. Run each task's exact test
file red before implementation and green afterward. Avoid starting production
composition in unit tests. Commit each verified task's explicit file set; do not
stage unrelated changes. Commit subjects appear in the task plans.

Before integration run `npm run check:parse`, `npm run audit:layers`,
`npm run audit:fs`, `npm run test:composition-contracts`, and
`npm run test:unit:vitest`. Inspect scripts in the execution revision before running
broader gates. Runtime acceptance uses the no-webServer config created in C2.

## Coverage audit

| Spec requirement | Owning tasks |
|---|---|
| Provider-neutral vocabulary and dependency boundaries | A1, A2, A6, C1 |
| Actual-mode selection and readiness scope | A1, A2, B1, B3 |
| Durable ownership, generation, cleanup and capacity | A3, A4 |
| Client observations and single recovery authority | A5, A6 |
| Optimistic fast path, deduplicated episodes and learned selective triggers | A0, A1, A4, A5, B4, C2 |
| Preparation, admission, validation, adaptive sets, storage | B1–B4 |
| Audio/subtitles, pause, seek, live and opaque sources | A1, A2, A5, B2, C1–C2 |
| Fault matrix, household devices, rollout and rollback | C1–C3 |
| Honest statuses and correlated measurements | A6, B4, C2–C3 |

Review state: written plan for user review. Execution method has not been selected.
The invoked writing-plans skill requires plan review and method selection before
implementation. No implementation, live configuration change, or acceptance run
is implied by these documents.
