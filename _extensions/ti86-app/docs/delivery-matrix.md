# SchoolCalc Adaptive Study v1 delivery matrix

This matrix tracks implementation and proof against the canonical
[`schoolcalc-v1-requirements.md`](./schoolcalc-v1-requirements.md). Existing v0
tests and binaries count only as retained-foundation evidence; they do not make
an Adaptive Study row complete.

## Status legend

| State | Meaning |
| --- | --- |
| specified | normative v1 contract exists; implementation is not yet claimed |
| partial | some production implementation and focused tests exist |
| implemented | production path and automated contract tests exist |
| proven | required exact-binary/relay/hardware acceptance evidence is retained |

## Product and content

| ID | Requirement | State | Required evidence |
| --- | --- | --- | --- |
| AS-01 | Unit opt-in descriptor and mode validation | specified | valid fixture plus missing/invalid mode rejection |
| AS-02 | `itemCount <= cardCount`, compatible A-E bank items, exposure cap 1-4 | specified | boundary and incompatible-bank tests |
| AS-03 | Reject actual TI/SCSP/draft/QR encoded-size overflow; never truncate | specified | exact ceiling and ceiling+1 codec tests |
| AS-04 | Authored-order curation with immutable bank revision and IDs/order | specified | deterministic repository/application test |
| AS-05 | Persist learner, unit/topic, policy, artifact, and exact prescription | specified | storage round trip and first-write-wins conflict test |

## Agenda and code lifecycle

| ID | Requirement | State | Required evidence |
| --- | --- | --- | --- |
| AS-10 | Pure `agenda.mjs` carries descriptor into entry and `section.next` | specified | side-effect/RNG-free domain test |
| AS-11 | Mutating builder ensures generic work plus one immutable study session | specified | retry/concurrency application test |
| AS-12 | Six-character opaque code preserves zeroes, is reused for open work, and is never reassigned | specified | collision/history/rebuild tests |
| AS-13 | Printed eligible task shows `123 456` and “Enter on calculator.” instead of subject-next token | specified | rendered agenda fixture |
| AS-14 | Dry-run performs zero writes and only projects existing code/eligibility | specified | repository-spy preview test |
| AS-15 | Accepted pass serves subject; accepted fail closes attempt and next build creates fresh remediation code | specified | end-to-end policy tests |

## Calculator experience and durable state

| ID | Requirement | State | Required evidence |
| --- | --- | --- | --- |
| AS-20 | Cold/warm startup always opens `ENTER CODE` with optional contextual Resume | specified | named MAME cases |
| AS-21 | `DSENTRY/SCE1` binds device, request, and code and clears only after exact ACK | specified | codec plus interrupted-sync cases |
| AS-22 | `DSSTUDY/SCSP` continuation is canonical; `DSSTDNEW` is staging only | specified | copy-on-write and power-cut tests |
| AS-23 | Front/back rails exactly match FLIP/blank/AGAIN/HARD/KNOW; F2 inert | specified | semantic and behavior MAME assertions |
| AS-24 | AGAIN due after two, HARD after four, KNOW/cap retirement, earliest-due fallback | specified | deterministic scheduler unit/MAME cases |
| AS-25 | Rating persists before next card; EXIT pauses; resume neither loses nor double-counts work | specified | restart at every transition |
| AS-26 | Compact summary -> one prescribed A-E quiz; no same-session remediation | specified | exact-binary complete path |
| AS-27 | Result is queued before success; local code reopens Result | specified | queue readback and relaunch case |
| AS-28 | Only one unfinished continuation; multiple completed results queued | specified | capacity/recovery tests |

## Result codec and importer

| ID | Requirement | State | Required evidence |
| --- | --- | --- | --- |
| AS-30 | Four-bit final rating/exposure per card and four-bit quiz choice per item | specified | full-value codec round trip |
| AS-31 | Durable draft <=48 bytes and Version-5/M QR payload <=69 actual bytes | specified | encoder ceiling/overflow tests |
| AS-32 | `ti86.cli.mjs` decoded result inspection | specified | retained case asserts code, telemetry, answers, score |
| AS-33 | QR and cable share one importer and canonical identity | partial | existing v0 importer pattern; adaptive mode tests required |
| AS-34 | First valid result closes; identical redelivery duplicates; different closed-session work conflicts | specified | atomic importer concurrency/replay tests |
| AS-35 | Backend regrades immutable artifact and rejects inconsistent local evidence | partial | existing v0 regrade pattern; adaptive payload tests required |

## Relay transaction

| ID | Requirement | State | Required evidence |
| --- | --- | --- | --- |
| AS-40 | Resolve code with full learner/work/bank/device reauthorization | specified | API/application authorization matrix |
| AS-41 | Installed artifact transfers prescription/ACK only | specified | virtual-relay transaction trace |
| AS-42 | Missing artifact commits artifact -> `DSSTDNEW` -> `DSSYNC` | specified | ordered trace plus power cut at every boundary |
| AS-43 | Unknown/closed/unauthorized/memory/incompatible/interrupted outcomes retain canonical state | specified | virtual-relay and calculator recovery cases |
| AS-44 | Result queue imported before outbound resolution and exact ACK removes only exact item/request | partial | retained sync/queue primitives; v1 integrated tests required |
| AS-45 | Protected direct-link and SCF1 infrastructure | partial | host tests exist; TilEm and physical transaction gates remain |

## Packaging and route exclusion

| ID | Requirement | State | Required evidence |
| --- | --- | --- | --- |
| AS-50 | Default manifest contains `ASCHL`, shell, adaptive `SCLEARN`, `SCQUEUE`, QR, sync, and shared support | specified | manifest contract test |
| AS-51 | Catalog/profile/tutor/native/general-lesson programs and `DSCODE` omitted | specified | negative manifest assertions |
| AS-52 | No inactive screen reachable | specified | state/dispatch inspection plus named MAME absence case |

## Acceptance lanes

| Lane | Scope | State | Promotion requirement |
| --- | --- | --- | --- |
| domain/application | content, agenda, sessions, policy, importer | specified | focused unit/integration suite passes |
| host codec | SCSP/SCE1/result encoding and byte limits | specified | golden, corruption, ceiling, round-trip tests pass |
| MAME exact binary | startup, study scheduling, pause/resume, quiz, queue, QR, route absence | specified | `--case-id` transcripts promoted to scenario YAML |
| virtual relay | real production relay session with fixture API/TI adapters | partial | v1 installed/missing/power-cut matrix passes |
| TilEm peer | actual port-7 download transaction | specified | artifact/prescription/ACK traces pass |
| physical TI-86 | protected link, keys/LCD, QR, power recovery | specified | hardware gates pass on release bytes |

## Current critical path

1. Implement and test curriculum opt-in, deterministic curation, study-session
   persistence, and agenda issuance without changing `agenda.mjs` purity.
2. Freeze `SCE1`, `SCSP`, and adaptive-result byte layouts from actual budget
   tests, then add decoded CLI inspection.
3. Restrict the default package and shell dispatch to the v1 route.
4. Implement the scheduler, durable continuation, quiz, queue, and QR path in
   `SCLEARN`/shared runtimes.
5. Extend combined sync and backend import, then pass virtual-relay/TilEm power
   cut and idempotency matrices.
6. Promote stable MAME paths and execute protected physical hardware gates.
