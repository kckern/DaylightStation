# Rendering consumers: impact and original-suite evidence

`rendering-consumer-review.json` records 84 test files reached from fourteen
edited rendering modules, with a dependency-edge witness for each. Twenty-five
are rendering suites. This is conservative source reachability, including
comments-only edits and test imports; it does not certify runtime activation.

Four inspected suites now pass their original assertions in disposable baseline
and candidate layouts:

| Suite | Original cases per layout | Runner |
|---|---:|---|
| Fitness TimelapseFrameRenderer | 2 | Node |
| Piano pianoRollImage | 4 | Root Vitest 4.1.10 |
| Eink stub-widgets | 5 | Root Vitest 4.1.10 |
| School workbookTheme | 12 | Backend Vitest 4.0.18 |

Receipt: [six successful runner steps](evidence/rendering-consumers-2026-09-06T15-02-21.130Z.json).
The original 23 named cases pass in each layout; assertion bodies are unchanged.
The candidate contains 48 copied source/test files, twenty specified edits,
three shared helper relocations, five new locator/facade files and nine relocated
font/notice assets. Retained callers use their original import maps; their
changed shared imports resolve through the proposed public package entries.
All 125 fixture files and thirteen links remain unchanged after testing.

The experiment uses installed backend canvas 3.1.0, pdfkit 0.18.0 and MathJax
3.2.2. It fingerprints 120 native/direct runtime/parser/runner files. This does
not certify the full transitive install or the backend locked canvas version.
Three planned utility changes in the selected source closure remain pending
and are named in the JSON specification.

Two additional primitive suites already have separate evidence. Nineteen
rendering suites and fifty-nine transitive application/API/composition/CLI/operator
test files retain explicit follow-up dispositions. Full byte parity, PDF
default/override behavior, Timelapse font retry semantics, remaining original
suites, package/lock/Linux build and layer enforcement still need evidence.
The 23 cases are separate from the existing 345-case catalog and eleven product
red/restored pairs; repeated before/after execution does not multiply coverage.

Reproduce with `CMD-RENDERING-CONSUMERS` in `command-safety.json`; rerun when its
source/specification/runner/dependency fingerprints change. The packet audit
checks freshness, named outcomes, copied source hashes and restoration.
The initial ad hoc launch failed at a nonexistent Node path before loading
tests. The reusable runner uses `process.execPath`; no product repair was needed.
