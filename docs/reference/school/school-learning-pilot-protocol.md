# School learning pilot protocol

> **Status:** specified, not executed. This protocol is an engineering and
> formative-usability pilot. With a household-sized sample it cannot establish
> that SchoolCalc or any other School surface causes better learning outcomes.

## Decisions this pilot may support

The pilot answers whether learners can complete the intended cross-surface
workflow safely and whether the collected evidence is credible enough to plan
a larger evaluation. It may support changes to navigation, wording, prompt
frequency, retry behavior, content pacing, and transport recovery. It must not
be used to rank learners, assign ability labels, or claim comparative efficacy.

Before the first participant begins, freeze a dated pilot record containing:

- participant count and age/grade bands;
- the exact content-pack and client-release digests;
- calculator IDs, ROM versions, relay firmware digest, and surface versions;
- selected lessons, concepts, item IDs, and answer keys;
- the scenarios, ordering, assistance policy, and thresholds below;
- planned exclusions and the analysis script/version; and
- consent, retention, deletion, and incident contacts.

Any later change is an amendment, not a silent edit.

## Pilot questions

1. Can a learner identify themselves, find assigned content, resume their
   place, and distinguish local work from synchronized work?
2. Can a learner complete notes/examples/probes/practice/quiz without a cable,
   see an immediate locally computed score, and choose a sensible next action?
3. Do QR-first and cable-first uploads converge to one credited result while
   retaining both arrival records?
4. Does accidental unplugging leave visible, recoverable state with no lost or
   duplicated academic evidence?
5. Are probe explanations and bounded retries understandable without changing
   the immutable first-response score?
6. Is optional reflection useful and brief, or does it become cognitive load?
7. When connected remediation is offered, can the learner use A–E plus
   stop/skip/explain/challenge, recover from disconnect, and understand the
   terminal summary?
8. Can an adult interpret concept/item/pacing signals without reading them as
   rankings or permanent learner traits?

## Design

Use two stages.

### Stage A — protected technical walkthrough

An adult operator follows the exact hardware matrix with test profiles and
known answers. This stage establishes that it is safe to expose the workflow
to a learner; it does not collect learning outcomes.

### Stage B — formative learner sessions

Use a within-learner sequence of two short, unfamiliar but age-appropriate
concepts. Counterbalance which concept is completed on the TI-86 and web when
the sample permits. Use parallel, not repeated, items for pre-check,
instructional probes, immediate post-check, and a delayed check 2–7 days later.
Record the order. Do not infer a surface effect from a household-sized sample;
report individual traces and descriptive aggregates only.

The authored flow for each concept is:

```text
brief unscored pre-check
→ notes/example
→ embedded learning probe
→ practice
→ one-pass quiz
→ optional reflection
→ conditional remediation offer
→ delayed parallel check
```

Retries after probe feedback are improvement evidence and never replace the
first response. A quiz remains one pass.

## Scenario matrix

| ID | Scenario | Required observation |
| --- | --- | --- |
| P-01 | Cold start with no selected profile | Learner can choose an eligible household member or Guest; parents are absent from the picker |
| P-02 | Switch learner, then return | Each learner sees only their Catalog/progress; no session or answer crosses identity |
| P-03 | Assigned Catalog browse | Catalog → Subject → Course → Unit → Lesson → Module is understandable; hidden lessons are not inferable through direct hydration |
| P-04 | Offline notes/examples/probe/practice/quiz | Content remains usable without relay; first-answer score and queue state are visible |
| P-05 | App exit/APD/re-entry after every durable boundary | Exact focus/module/item/draft returns or an honest recovery message appears |
| P-06 | QR upload, then cable sync | One credited result, two arrival provenances, duplicate acknowledgement, and eventual local queue removal |
| P-07 | Cable upload, then QR scan | Same convergence with reversed transport order |
| P-08 | Unplug during each relay phase | Direction/presence/safety changes promptly; retry resumes without content/evidence loss |
| P-09 | Relay/server unavailable | Offline completion remains possible; queued work is not called synchronized |
| P-10 | Low-score remediation, normal completion | Turns remain fresh/bounded/grounded; controls and terminal summary are understood |
| P-11 | Unplug during remediation | Session becomes visibly disconnected and resumes from client/server cursors without duplicate turns |
| P-12 | Decline/stop remediation | Authored lesson remains complete; no punitive label or blocked pathway appears |
| P-13 | Adult instructional overview | Adult can explain signal basis, expiry, evidence limits, and a possible instructional—not placement—response |
| P-14 | Shared relay, three calculators sequentially | Each device resolves its own opaque identity, roster, Catalog, queue, and acknowledgements |

Stage A must also run the extension-owned protected link, memory-pressure,
dynamic-QR, native-return, battery-loss, and three-calculator fleet gates named
in `_extensions/ti86-app/docs/hardware-test-gates.md`.

## Measures

### Technical integrity

- intended result records versus accepted, duplicate, conflict, and rejected;
- queue depth before/after every transfer and time to acknowledged removal;
- disconnect-detection latency, reconnect attempts, resume success, and bytes
  retransmitted;
- wrong-profile, wrong-device, stale-artifact, checksum, and local-score
  disagreement counts;
- content install/update/remove success and remaining free memory; and
- crashes, memory clears, lost continuation, silent failures, or operator
  intervention.

### Usability and cognitive load

- task completion and time by scenario;
- first wrong turn, backtracks, abandoned task, and assistance count;
- whether the learner can state cable status, queue status, and score status in
  their own words;
- one short post-module effort rating (1–5) and optional confidence rating;
- reflection completion/skip rate and time spent; and
- tutor turn count, learner controls used, repeated-turn rejections, early stop,
  and terminal-summary comprehension.

### Learning signals

- pre-check, immutable first probe response, one-pass quiz, and delayed
  parallel-check accuracy;
- concept-level error transitions rather than only whole-quiz totals;
- feedback viewed, retry choice, and retry correctness kept separate;
- transfer item performance when the content supports a genuinely new form;
  and
- missing/pending evidence reported explicitly rather than scored as wrong.

These are pilot signals, not grades and not causal estimates.

## Engineering readiness thresholds

Thresholds gate a larger pilot; they do not certify educational effectiveness.

- zero lost or multiply credited attempts in all deterministic transport
  scenarios;
- zero cross-learner or cross-device attribution;
- zero silent disconnects, silent unrecorded answers, or false “safe to unplug”
  states;
- 100% recovery in scripted cable-pull/APD boundaries, or a reproducible
  blocking defect with retained prior canonical data;
- every participant completes the core offline flow with no more than one
  operator rescue after onboarding;
- at least 80% correct unaided explanations of “saved here,” “queued,” and
  “synced” status; and
- no severity-1 privacy, answer-key, arbitrary-code, or data-loss defect.

Failure pauses expansion and produces a defect/retest record. It never causes a
participant's evidence to be manually rewritten to make the run pass.

## Evidence and anonymized export

Export append-only events through a pilot-specific adapter; do not query or
mutate domain storage from a reporting script. Replace learner/device IDs with
pilot-scoped random codes and keep the re-identification key outside the
export. Retain structural curriculum IDs because the analysis needs them.

Minimum row shape:

```yaml
pilotId: pilot-2026-01
participantCode: P03
endpointCode: D02
scenarioId: P-08
occurredAt: 2026-08-02T18:00:00.000Z
eventKind: disconnect_detected
activity:
  sessionId: pilot-scoped-id
  itemId: optional
learning:
  catalogId: main
  subjectId: quantitative
  courseId: rates
  unitId: unit-rates
  lessonId: intro
  moduleId: check
measures: {}
source:
  surface: schoolcalc
  transport: relay
technical:
  relayPhase: upload_queue
  queueDepth: 2
  connectionState: disconnected
```

Do not export names, free text containing personal data, raw AI prompts,
answer keys, bearer/action tokens, network addresses, Bluetooth identifiers,
or device serial-like identities. Define deletion date before collection and
honor withdrawal by deleting the re-identification key and participant rows.

## Observation and assistance rules

- Use think-aloud only in the dedicated usability run; do not mix it into timed
  learning measures.
- Record assistance as none, neutral prompt, directional hint, or takeover.
- A neutral prompt may restate the task but may not name the correct answer or
  UI control.
- Stop immediately for distress, suspected private-data exposure, repeated
  hardware reset, battery heat/leak, or evidence attributed to the wrong
  learner.
- Preserve logs and immutable artifacts for a defect while applying the pilot
  retention policy; never preserve secrets in screenshots or exports.

## Analysis and reporting

Publish counts and per-scenario traces first. For a very small sample, show
individual pre/immediate/delayed results and medians/ranges; do not report a
p-value, effect size, or surface winner. Separate:

1. technical integrity;
2. usability/cognitive-load observations;
3. descriptive learning signals;
4. accessibility/equity observations;
5. defects and protocol deviations; and
6. decisions, non-decisions, and next experiment.

Link the frozen protocol, release/artifact digests, anonymized export digest,
analysis version, and issue IDs. A result is “not observed” when instrumentation
is absent; it is never inferred from missing events.

## DDD ownership

The protocol is reference/product documentation, not a sixth application
layer. Learning and evidence meanings remain in `backend/src/2_domains/school`;
use cases and export ports remain in `backend/src/3_applications/school`;
persistence/de-identification implementations remain adapters; HTTP remains a
thin projection; TI and relay instrumentation remain in their extensions.
