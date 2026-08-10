# SchoolCalc Adaptive Study v1 packaging

This document refines the release boundary in
[`schoolcalc-v1-requirements.md`](./schoolcalc-v1-requirements.md). It describes
the default installation, not every SchoolCalc program retained in source.

## Default client manifest

The digest-pinned v1 client contains only:

| Component | Purpose |
| --- | --- |
| `ASCHL.86p` | TI-OS launcher for the shell |
| `SCHLCALC.86p` | six-digit-gated `ENTER CODE` shell and entered-code study/result dispatch |
| `SCLEARN.86p` | adaptive cards, summary, and one prescribed A-E quiz |
| `SCQUEUE.86p` | backup-first append and exact acknowledgement removal |
| `SCQR.86p` | Version-5/M rendering of one immutable queued result |
| `SCSYNC.86p` | combined result upload and one-time code resolution |
| shared records/state/assets | input, UI, CRC, commit, fonts, and required initial durable variables |

The release builder MUST enumerate program/variable names, byte lengths, and
digests and MUST fail if a required capability is absent or an inactive route
is included. Independent `.86p`/String transfers are preferred so a failed
packet can be retried without accepting a partially installed monolithic group.

## Content and prescription

The backend curates one session from a bank-backed unit in authored order and
persists the exact bank revision, IDs/order, learner/topic, and policy. The
calculator receives:

1. one immutable non-executable artifact containing the selected cards, quiz
   items, choice labels, and local answer evidence; and
2. one `SCSP` device-bound prescription identifying exactly how that artifact
   is used for the agenda study session.

Artifact identity is content-addressed/first-write-wins. The prescription is
session-specific and is not inferred from a locally browsable Catalog. A bank
revision change creates different future artifacts; it never changes an open
session.

If the artifact is already installed, resolution transfers only `DSSTDNEW` and
the exact acknowledgement transaction. If missing, the relay writes/verifies
the artifact, then `DSSTDNEW`, then `DSSYNC` last. A staged prescription is not
selectable before that commit.

## Size gates

The builder and codec validate actual encoded bytes and reject rather than
truncate:

- every visible TI-86 string/layout bound;
- executable and free-RAM safety windows;
- artifact and staged-replacement memory requirements;
- the complete `SCSP` prescription/continuation representation;
- the 48-byte durable adaptive-result draft ceiling; and
- the 69-byte final Version-5/M result-QR ceiling.

## Inactive source

The following are omitted from the default v1 manifest even if their sources
and standalone builders remain:

- `SCCAT`, Catalog snapshots, and install/remove navigation;
- `SCREQ` delivery-choice UI;
- `SCPROF`, rosters, Guest mode, and progress projections;
- `SCTUTOR` and realtime interaction records;
- `SCNATIVE` and native-tool handoff;
- notes, examples, general lesson menus, and `DSCODE`/`SCCO`.

No active component may load, dispatch, or require these variables/programs.
A research/diagnostic bundle must have a different manifest identity and must
not be labeled the Adaptive Study v1 default release.

## Packaging acceptance

Automated contract tests inspect the emitted directory and manifest to prove:

- all active components are present once and digest-pinned;
- every inactive component above is absent;
- cold launch has all state needed to show `ENTER CODE`;
- a resolved fixture has all state needed to study, quiz, queue, and render QR
  with no relay; and
- removing every retained v0-only artifact from the fixture does not break an
  active v1 route.
