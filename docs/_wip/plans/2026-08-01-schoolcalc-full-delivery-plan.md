# SchoolCalc full-delivery plan

## Objective

Implement every v0 requirement in
[`_extensions/ti86-app/docs/schoolcalc-requirements.md`](../../../_extensions/ti86-app/docs/schoolcalc-requirements.md)
across the School domain/application/API, calculator-family adapters, ESP
relay, and TI-86 shell. Prove every hardware-independent contract
automatically and leave explicit, reproducible gates for evidence that requires
the three physical calculators or relay circuit.

The live requirement-level state is
[`_extensions/ti86-app/docs/delivery-matrix.md`](../../../_extensions/ti86-app/docs/delivery-matrix.md).

## Dependency-ordered delivery

### Milestone A — canonical contracts

- Reconcile the QR/result/progress and Catalog/request/sync records.
- Complete generic activity, game, custom-module, capability, install-set,
  device, result, and progress invariants.
- Add pure domain tests and a SchoolCalc-specific layer-import audit.

### Milestone B — application core

- Build enrollment, observation, Catalog projection, artifact build/retrieval,
  delivery request, result/progress import, and sync use cases.
- Use injected ports and a codec registry; contain no calculator-family branch.
- Run the same use-case contract suite against TI-86 and a deliberately
  different fake future-family codec.

### Milestone C — adapters and persistence

- Implement mounted YAML content repositories.
- Implement optimistic device persistence, immutable first-write-wins artifact
  persistence, request state, progress state, and atomic idempotency ledger.
- Complete every TI-86 variable codec with golden bytes, length/CRC/version
  failures, answer-redaction, resource limits, and deterministic identity.

### Milestone D — School API and composition

- Add handler factories and a child SchoolCalc router mounted under
  `/api/v1/school/calc`.
- Keep the HTTP layer injection-only; decode HTTP transfer encodings but no TI
  records or YAML.
- Test status codes, binary headers/ETag, conditional Catalog reads, relay auth,
  malformed bodies, and every idempotency response.

### Milestone E — relay

- Extract pure TI packet/container codecs and the sync state machine from
  Arduino dependencies so they run as native host tests.
- Implement silent variable read/write, bounded retry, readback/commit, API
  client calls, flash retry cache, attachment identity, safe-to-unplug status,
  and observability.
- Keep electrical pin driving behind the existing safety gate and dedicated
  timing task.

### Milestone F — TI-86 shell

- Build the ≤8 KB core shell, custom font/icon renderer, layout/component
  primitives, Catalog browser, artifact parser, module runners, local state,
  queue, QR presenter, and native handoff.
- Consume the exact golden binary fixtures emitted by the backend adapter.
- Add host/emulator tests for parsers and state transitions before hardware.

### Milestone G — conformance and hardware

- Run architecture, unit, adapter, API, cross-component, malformed-input,
  disconnect, power-loss-model, resource, render, QR, and firmware builds.
- Execute the protected-link screenshot, harmless variable round trip,
  install, offline study, QR/cable duplicate, reconnect, and native handoff
  runbooks on every ROM revision in the three-device fleet.
- Update the delivery matrix only from direct evidence and declare completion
  only when no non-hardware item is partial/missing and every hardware row has
  its recorded result.

### Milestone H — research-derived School learning loop

This is owned by the School bounded context and its application use cases.
SchoolCalc/TI-86 is one bounded downstream projection alongside web and kiosk
surfaces; it does not define the pedagogical model.

- Use the overview → focus → stable-inspector grammar for evidence-backed
  curriculum history, dense reference modules, flashcard/long-set coverage,
  skill maps, timelines, and error review; always retain a list fallback.
- Add subject-neutral, lesson-embedded learning probes with immediate feedback
  and separately recorded evidence.
- Add optional forethought/performance/reflection evidence (confidence,
  bounded error analysis, preparation strategy, and learner-selected next
  action) without changing the academic score.
- Bound connected tutoring by authored objectives, a turn budget, repetition
  detection, learner stop/skip/explain controls, and a terminal summary.
- Add adult misconception/pacing read models and an intervention feedback loop
  without learner ranking or permanent ability tracks.
- Execute the pilot protocol before claiming learning efficacy. The evidence,
  scoring, layer ownership, and prioritized gaps are maintained in
  [`docs/reference/school/edtech-research-audit.md`](../../reference/school/edtech-research-audit.md).

As-built checkpoint (2026-08-02): overview/detail history, embedded probes,
score-independent post-task reflection, bounded/fresh learner-controlled
tutoring, misconception/pacing read models, recommendation explanation/expiry,
and anti-ranking mobility contracts are implemented with automated evidence.
Sparse before/during-task reflection and the adult intervention write/resolution
loop remain software gaps. The pilot is specified in
[`school-learning-pilot-protocol.md`](../../reference/school/school-learning-pilot-protocol.md)
but has not been executed; emulator and physical fleet gates remain explicit.

## Research decisions already established

- The TI-86 guidebook reports 98,224 bytes free in its blank-memory example,
  supports assembly programs through `Asm(`, and documents PC/Mac link plus
  Silent Link behavior.
- The TI-86 link packet is machine ID, command, little-endian data length,
  optional data, and additive checksum. Silent variable reads/writes have
  explicit ACK/CTS/DATA sequences and overwrite same-name variables, so
  SchoolCalc must use staging/readback rather than relying on a prompt.
- M5Stack documents ATOM Lite as ESP32-PICO-D4 with 520 KB SRAM, 4 MB flash,
  and exposed GPIO25/26/32/33. Espressif identifies boot-strapping pins; the
  selected four SchoolCalc interface GPIOs are not those strapping pins.
- DENSO WAVE documents QR versions as 21×21 modules at Version 1 plus four
  modules per side per version and supports alphanumeric mode. This matches the
  physical 58×58 action and 61×61 result profiles already scanned on TI-86.

## Primary/manufacturer sources

- Texas Instruments, [TI-86 Guidebook](https://education.ti.com/download/en/ed-tech/29D96806F8F4429C82F75713DF53EA1C/C7CFB64BF4924AD1BE8A514E7EF98E4A/86bookeng.pdf).
- TI linkguide source material, [TI-86 packet format](https://merthsoft.com/linkguide/ti86/packet.html), [variable format](https://merthsoft.com/linkguide/ti86/vars.html), and [silent transfers](https://merthsoft.com/linkguide/ti86/silent.html).
- M5Stack, [ATOM Lite specification and pin map](https://docs.m5stack.com/en/core/ATOM%20Lite).
- Espressif, [ESP32-PICO Series datasheet](https://documentation.espressif.com/esp32-pico_series_datasheet_en.html).
- DENSO WAVE, [QR Code versions and capacity](https://www.qrcode.com/en/about/version.html/versionPage/error_correction.html) and [QR FAQ](https://www.qrcode.com/en/faq.html/about/howto/cell.html).
