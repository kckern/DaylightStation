# SchoolCalc Adaptive Study v1 CLI test plan

`ti86.cli.mjs` is the exact-binary calculator exploration loop. It transfers a
digest-pinned installation through MAME's virtual Graph Link, launches
`ASCHL` through TI-OS, drives the real TI-86 key matrix, decodes the 128x64
LCD, and reads retained calculator variables. It is not a JavaScript model of
the product.

The canonical behavior is
[`schoolcalc-v1-requirements.md`](./schoolcalc-v1-requirements.md).

## Startup model

There is one startup destination: `ENTER CODE`.

| Local condition | Required entry behavior |
| --- | --- |
| no prescription | empty six-digit editor |
| unresolved `DSENTRY` | code editor plus plain connect/retry status |
| one unfinished `DSSTUDY` | Enter Code plus contextual Resume |
| queued completed result for entered code | reopen Result/QR; never restart study |

Profile picker, Subject, Catalog, lesson menu, notes, examples, My Progress,
tutor, and native-tool screens must not appear or be reachable.

## Test conventions

- Use the default v1 release manifest, not the retained v0 complete bundle.
- Select named cases with `--case-id`; every stable acceptance route is
  promoted to `testing/mame-scenarios.yml`.
- Capture `--screens each --screen hybrid` and retain the transcript on
  failure. Pixel assertions supplement semantic assertions only where exact
  rail/QR geometry matters.
- Wait for real TI-OS child-runtime handoffs. A key pressed during handoff is
  not interaction evidence.
- Begin each scenario in a new MAME process. Restart/resume within the same
  process so calculator variables persist without retransferring fixtures.
- Assert semantic text and symbols, including absent softkeys. An LCD change
  alone is insufficient.
- Use fixture builders to preinstall immutable artifacts, `DSSTUDY`, staged
  records, and queues. MAME cannot prove a live port-7 relay transaction.

## Required named scenarios

| Case ID | Setup / route | Required assertions |
| --- | --- | --- |
| `cold-enter-code` | fresh v1 bundle -> `ASCHL` | first screen is `ENTER CODE`; inactive routes absent |
| `unknown-code-relay` | enter code absent locally | `DSENTRY/SCE1` retains exact zero-padded code, device, request; recovery asks for relay |
| `resolved-code-prescription` | preinstall exact artifact + `DSSTUDY` | entered code opens prescribed learner/topic and first authored card |
| `again-two-card-spacing` | rate first card AGAIN | it returns only after two intervening presentations |
| `hard-four-card-spacing` | rate first card HARD | it returns only after four intervening presentations |
| `f2-blank` | inspect/press F2 on front and back | slot has no pixels and key produces no state change |
| `power-safe-resume` | pause after a committed rating; relaunch | opens Enter Code with Resume; exact next card/count resumes |
| `study-quiz-result-qr` | complete study and prescribed quiz | summary has F5 QUIZ; result exists before success; Version-5/M QR renders |
| `completed-code-result` | return to code entry and re-enter completed code | Result reopens; study/quiz do not restart |
| `inactive-routes-absent` | exhaust all shell keys/routes | no v0 learner screen or dispatch is reachable |

## Decoded result inspection

`ti86.cli.mjs --debug-result` reads the actual retained queue variable through
the virtual Graph Link during a case. `--inspect-result-file DSQ.86s` performs
the same semantic decode on a retained transfer without MAME. Both validate
the envelope and checksum, select the newest result,
Graph Link, validates the envelope and checksum, selects the requested result,
and emit deterministic semantic fields:

```text
sessionCode: 012345
cards: 0=AGAIN/3,1=KNOW/1,2=HARD/4,...
quizChoices: A,C,E,B,...
score: 8/10
```

The output must come from decoded calculator bytes, not scenario fixture
metadata or LCD text. It rejects noncanonical padding, counts inconsistent
with the prescription, invalid rating/exposure nibbles, invalid choice
nibbles, checksum errors, and payloads above the 69-byte QR ceiling. Named
completion cases assert the decoded code, every card summary, quiz choices,
and local score.

## Interruption matrix

| Point | Required invariant |
| --- | --- |
| before first card | prescription remains open at authored first card |
| front/back flip | flip alone does not increment exposure or record rating |
| after rating commit, before redraw | relaunch shows correct next due card; no double count |
| during summary -> quiz | study completion remains durable; quiz starts once |
| during quiz answer commit | committed answers persist; current item is unambiguous |
| before result append | no success is shown; retry can finish once |
| after result append, before Result | relaunch/re-entry opens Result |
| while QR is visible | queued record remains unacknowledged and byte-identical |

Corrupt disposable slots/fixtures in diagnostic variants to verify a concise
safe error and preservation of the last canonical state.

## Relay acceptance boundary

Stock MAME does not emulate the TI-86 port-7 peer. It can prove staged and
committed calculator states, but not the download transaction. These cases run
against production relay session logic in virtual-relay and TilEm lanes:

- installed artifact -> `DSSTDNEW` -> acknowledgement;
- missing artifact -> artifact -> `DSSTDNEW` -> `DSSYNC`;
- power loss/cable removal after every write;
- unknown, closed, unauthorized, incompatible, and insufficient-memory code;
- cross-device resolution rejection; and
- cable result acceptance, exact duplicate, and conflicting closed-session
  work.

## Promotion gate

An exploratory transcript is diagnostic evidence only. Promote a case after
its route is deterministic, its semantic and decoded-state assertions are
stable, and its fixture uses the default v1 manifest. The complete MAME suite
must pass on release bytes before physical USB/link smoke tests. Physical tests
verify the same keys, LCD, QR readability, memory safety, and power recovery;
they do not replace domain, importer, or relay transaction tests.
