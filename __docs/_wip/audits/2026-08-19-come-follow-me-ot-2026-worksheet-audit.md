# Come Follow Me OT 2026 worksheet audit

**Final decision:** keep all 85 worksheet banks after remediation. No bank is
still flagged for regeneration. All 85 lesson indexes remain
`reviewState: draft`; this audit does not approve or publish the course.

## Corrected scope

The first audit classified 25 banks as keep and 60 as regenerate. That result
under-counted shells because its placeholder detector recognized labels such as
`amber token 1`, but not numbered filler such as `amber marker 1` or
`A silver button 12`.

The corrected classification and disposition are:

| Group | Banks | Disposition |
|---|---:|---|
| Original token-placeholder shells | 60 | Regenerated |
| Additional numbered/marker shells in weeks 38 and 40 | 9 | Regenerated |
| Authored banks in weeks 35–37 with strict QA defects | 15 | Repaired in place |
| Authored bank already passing strict QA | 1 | Kept |
| **Total** | **85** | **85 pass** |

The nine additional shells were
`cfm-w38-d2-isaiah-3-5` through
`cfm-w38-d5-isaiah-11-12`, plus all five week-40 banks. They contained 774
numbered filler decoys.

## Final corpus

| Measure | Final result |
|---|---:|
| Weekly modules | 17 |
| YAML files parsed | 188 |
| Lesson indexes | 85 |
| Worksheet banks | 85 |
| Question items | 935 |
| Single-answer items | 765 |
| Multi-select items | 170 |
| Decoys | 7,304 |
| Placeholder-shell banks | 0 |
| Hierarchy or bank-reference errors | 0 |
| Non-draft lesson indexes | 0 |

Every bank now contains exactly 11 items: nine upper-eligible single-answer
items and two upper-only multi-select items. At least six single-answer items
are lower-eligible, and the single-answer inventory spans at least six verse
locators.

## Remediation performed

- Regenerated 69 unusable shell banks from the local NIrV corpus with extractive
  answers, page/verse locators, authored same-category decoys, and lower/upper
  profile coverage.
- Repaired all 15 retained banks that failed strict QA. The repairs covered
  non-verbatim answers, wrong source pages, invalid whole-chapter or
  superscription locators, missing multi-select items, repeated answers,
  insufficient verse spread, incorrect Proverbs/Ecclesiastes topics, and
  decoys found in the assigned reading.
- Added 37 assigned-reading pages omitted from 32 lesson
  `provenance.printed_pages` lists.
- Removed three answer-cue collisions in regenerated banks:
  `cfm-w43-d5-jeremiah-20`,
  `cfm-w44-d3-jeremiah-36`, and
  `cfm-w50-d3-zechariah-3-4`.
- Standardized the one 14-item legacy bank to the required 11-item contract.
- Strengthened the authoring audit to detect `token`, `marker`, and
  trailing-number filler; require every assigned-reading page in lesson
  metadata; reject reused answers; normalize singular `Psalm`; and require
  exactly 11 items.

## Verification

Final verification against the live data tree on 2026-08-19:

| Gate | Result |
|---|---:|
| Strict source/authoring audit | 85 checked; 0 failed |
| Application worksheet validation | 85 checked; 0 failed |
| Lower and upper profile issuance | Both profiles issue for all 85 |
| Placeholder-only sweep | 0 banks found |
| YAML parse and hierarchy check | 188 files parsed; 0 errors |
| Lesson review state check | 85 draft; 0 non-draft |

Seeded lower and upper previews were inspected across regenerated and repaired
batches. Those spot-checks also caught and removed cross-question answer cues
and a final grammar typo that structural validation alone would not detect.

## Keep versus regenerate

There is no remaining regeneration queue. All 85 banks can be **kept as
remediated drafts**. They should remain draft until the normal human content
review decides whether to approve them for learners.

## Documentation note

The course `HANDOFF.md` still describes the earlier three-module state even
though the course now contains weeks 35–51. That documentation drift is
separate from worksheet correctness and was not changed by this remediation.
