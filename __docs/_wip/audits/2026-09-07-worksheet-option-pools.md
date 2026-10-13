# Worksheet option-pool audit — 2026-09-07

## Scope and result

Audited all 288 current question-bank YAML files under `data/content/school` using the production validator. No YAML parse failures. The atlas course contains 58 banks and 956 questions. Seven banks failed validation, containing eight oversized multi-select pools. All other banks validated.

All seven were repaired live on September 7: correct answers preserved; existing decoys reduced to keep each authored pool at ten choices. Each source has a `.before-20260907-pool-fix.bak` backup. No issued worksheet or recorded result was edited. The repaired bank successfully issued a worksheet through the lifecycle API.

## Affected source paths

All paths below are relative to `data/content/school/civilization/young-peoples-atlas-us/`. These are the actual course files; the logged `.../worksheet.yml` bank name is a logical identifier, not a separate file.

| Source path | Question ID | Original answers + decoys | Repaired decoys |
|---|---|---|---|
| `10-northeast/atlas-us-p078-new-jersey.yml` | `new-jersey-crops` | 8 + 5 | Cotton, Rice |
| `10-northeast/atlas-us-p082-new-york.yml` | `new-york-natural-boundaries` | 7 + 5 | Lake Superior, Lake Michigan, Ohio River |
| `10-northeast/atlas-us-p082-new-york.yml` | `new-york-city-roles` | 7 + 4 | Mining, Ranching, Logging |
| `10-northeast/atlas-us-p096-rhode-island.yml` | `rhode-island-manufactures` | 7 + 5 | Aircraft, Automobiles, Furniture |
| `20-south/atlas-us-p102-tennessee.yml` | `tennessee-borders` | 8 + 5 | South Carolina, West Virginia |
| `30-midwest/atlas-us-p068-missouri.yml` | `missouri-neighbors` | 8 + 5 | Indiana, Ohio |
| `40-southwest/atlas-us-p080-new-mexico.yml` | `new-mexico-minerals` | 8 + 5 | Nickel, Tin |
| `50-rocky-mountains/atlas-us-p106-utah.yml` | `utah-minerals` | 7 + 5 | Nickel, Tin, Platinum |

## Why the earlier fix was insufficient

Commit `609d153c9` changed the generator, not the validator. It samples correct answers to fit five printed choices and reserves at least one decoy whenever decoys exist. However the validator rejects an authored pool larger than ten BEFORE the generator is called. Direct generator-only tests therefore passed while the Portal could not load the bank.

The audit forced each of the 408 multi-select items across all 288 banks through the deployed generator individually: no all-correct result, no more than five printed choices, no generation failure. All multi-select questions have at least one authored decoy. Separately, 58 atlas banks × 4 learner seeds × 2 profiles generated 464 worksheets successfully. Those generator-only checks do not substitute for bank validation.

## Remaining editorial quality review

The repairs remove the production blocker. They do not constitute a factual review against all scanned atlas pages. Retained decoys were drawn from the existing authored pools; no new factual answers were invented.

Thirty atlas questions have five or more correct answers in their full pool. Under the current upper-profile generator these always print four correct choices and one decoy. This avoids “everything is right,” but repeats a learnable four-out-of-five pattern. For a stronger assessment, narrow or split long-list questions into source-grounded subquestions with two or three correct answers and multiple plausible decoys. Do not relabel an omitted true answer as a decoy. The prompt should say “Which of these…” when showing a sample.

Priority wording/decoy reviews:

- `indiana-transport-modes` and `illinois-chicago-transport`: distant or fanciful transport decoys (arctic ice roads, ocean whaling, desert caravans) are weak. Rewrite around specific claims supported by the page.
- `connecticut-land-regions`, `arkansas-landscapes`, and `midwest-glacial-effects`: coral islands, frozen tundra, volcanic peaks, etc. can make elimination too easy. Prefer plausible neighboring landforms or misconceptions after checking the source.
- `illinois-grain-crops`: review Corn as a decoy against the exact page and prompt. “Not listed in this paragraph” must not be presented as “not grown in the state.”
- `new-york-city-roles`, `missouri-manufactures`, and other industry/resource lists: explicitly anchor the question to what the atlas passage names; omission from a list is not evidence that an industry does not exist.

### Questions with the fixed four-correct/one-decoy pattern

| Source path | Question ID | Correct answers in pool |
|---|---|---|
| `10-northeast/atlas-us-p078-new-jersey.yml` | `new-jersey-water-borders` | 5 |
| `10-northeast/atlas-us-p078-new-jersey.yml` | `new-jersey-crops` | 8 |
| `10-northeast/atlas-us-p082-new-york.yml` | `new-york-natural-boundaries` | 7 |
| `10-northeast/atlas-us-p082-new-york.yml` | `new-york-city-roles` | 7 |
| `10-northeast/atlas-us-p094-pennsylvania.yml` | `pennsylvania-manufactures` | 6 |
| `10-northeast/atlas-us-p096-rhode-island.yml` | `rhode-island-manufactures` | 7 |
| `20-south/atlas-us-p038-georgia.yml` | `georgia-crops` | 5 |
| `20-south/atlas-us-p058-maryland.yml` | `maryland-landscapes` | 6 |
| `20-south/atlas-us-p084-north-carolina.yml` | `north-carolina-regions` | 5 |
| `20-south/atlas-us-p098-south-carolina.yml` | `south-carolina-crops` | 5 |
| `20-south/atlas-us-p102-tennessee.yml` | `tennessee-borders` | 8 |
| `20-south/atlas-us-p102-tennessee.yml` | `tennessee-industries` | 5 |
| `20-south/atlas-us-p110-virginia.yml` | `virginia-regions` | 5 |
| `20-south/atlas-us-p114-west-virginia.yml` | `west-virginia-neighbors` | 5 |
| `20-south/atlas-us-p114-west-virginia.yml` | `west-virginia-industries` | 6 |
| `30-midwest/atlas-us-p044-illinois.yml` | `illinois-grain-crops` | 5 |
| `30-midwest/atlas-us-p046-indiana.yml` | `indiana-transport-modes` | 5 |
| `30-midwest/atlas-us-p068-missouri.yml` | `missouri-neighbors` | 8 |
| `30-midwest/atlas-us-p068-missouri.yml` | `missouri-manufactures` | 6 |
| `30-midwest/atlas-us-p088-ohio.yml` | `ohio-industries` | 6 |
| `30-midwest/atlas-us-p116-wisconsin.yml` | `wisconsin-water-boundaries` | 5 |
| `30-midwest/atlas-us-p116-wisconsin.yml` | `wisconsin-farm-products` | 5 |
| `40-southwest/atlas-us-p080-new-mexico.yml` | `new-mexico-landforms` | 6 |
| `40-southwest/atlas-us-p080-new-mexico.yml` | `new-mexico-minerals` | 8 |
| `40-southwest/atlas-us-p090-oklahoma.yml` | `oklahoma-five-tribes` | 5 |
| `50-rocky-mountains/atlas-us-p074-nevada.yml` | `nevada-borders` | 5 |
| `50-rocky-mountains/atlas-us-p106-utah.yml` | `utah-minerals` | 7 |
| `50-rocky-mountains/atlas-us-p118-wyoming.yml` | `wyoming-native-peoples` | 5 |
| `60-pacific-coast/atlas-us-p092-oregon.yml` | `oregon-industries` | 5 |
| `60-pacific-coast/atlas-us-p112-washington.yml` | `washington-forest-products` | 5 |

## Post-repair verification

Re-ran the production validator against all 288 banks after the live edits:
**288 valid, zero invalid, zero YAML parse errors**. Portal recovery and piano
changes passed 567 regression tests; the subsequent added tablet-display and
immutable-reprint regressions passed with their 148-test focused suites.
