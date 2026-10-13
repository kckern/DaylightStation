# Big Fat Notebook batch authoring

This is the lean operating procedure for extractive Big Fat Notebook question banks. It exists to preserve source quality while avoiding repeated agent handoffs, stale-packet reviews, and per-item status churn.

## Operating model

Work in batches of three to five chapters. A chapter has exactly these normal stages:

1. **Author** — creates a complete 18-item bank, author review, and keyless blind packet.
2. **Deterministic preflight** — runs before any reviewer receives the packet.
3. **Independent blind review** — one reviewer reads only the blind packet and cited source pages, commits selections, then checks the keyed artifacts.
4. **Batch promotion** — append only passed banks to the ledger and deploy the whole batch once.

Do not use a calibration packet for every chapter. Calibration is only required for a new course, a new question format, or a chapter whose first full-bank preflight exposes an unknown source/format ambiguity. All ordinary follow-on chapters begin at the full 18-item bank.

## Before authoring a batch

Create a compact batch manifest containing only:

| field | purpose |
|---|---|
| chapter and target directory | prevents path discovery during work |
| exact source files/pages | gives author and reviewer one source map |
| author | owns the complete bank |
| assigned reviewer | must have no prior role in that chapter |
| state | `authoring`, `review`, `repair`, or `approved` |

Give each worker the exact worksheet, review, blind packet, selection, and approval paths. Reviewers must never list a staging directory or search for `*selection*`; that is how historic keyed artifacts leak into a blind review.

## Author contract

The author delivers the complete bank in one pass:

- Exact production mix: 12 shared multiple-choice, 3 lower-only multiple-choice, 1 upper-only multiple-choice, and 2 upper multi-select.
- Every item has a page-level source citation and a concrete rationale.
- Decoys are same-ontology, source-near alternatives. Do not use absolutes, unrelated nouns, reversals, generic statements, or visibly mismatched answer shapes.
- The author review must use validator-derived `stem_kind` and `answer_shape`, not guessed labels.
- Generate the blind packet mechanically from the final worksheet. Never hand-copy its hash or options.

Run the deterministic gate once, before review:

```sh
python3 cli/scripts/bfn-author-preflight.py "$BFN_ROOT" "$CHAPTER"
node cli/school.mjs worksheet validate "$CHAPTER/worksheet.yml"
python3 "$BFN_ROOT/make_blind_review_packet.py" \
  "$CHAPTER/worksheet.yml" "$CHAPTER/blind-production.yml"
```

`cli/scripts/bfn-author-preflight.py` uses the production validator with a deliberately
pending approval and fails on every author-controlled error. It also flags
absolute-language decoys before the packet reaches a reviewer. Production
promotion still requires the independent approval sidecar.

## Independent review contract

One independent review is the default. The reviewer:

1. Opens only the named blind packet and the listed source pages.
2. Commits selections in the designated blank file.
3. Opens the worksheet and author review only after committing selections.
4. Either creates a complete validator-conforming approval or records specific item IDs and reasons for rejection.

The reviewer must write the approval in a local handoff directory first. The primary authoring coordinator copies that exact artifact to synchronized staging after validation. This avoids cloud-write safeguards and preserves reviewer authorship.

## Repairs: choose the smallest valid scope

| change | required follow-up |
|---|---|
| author-review label/rationale only; worksheet hash unchanged | rerun deterministic preflight; keep the existing independent selection/approval |
| blind packet formatting/order only; worksheet hash unchanged | regenerate packet; keep the existing independent selection/approval |
| any prompt, key, option, source, or decoy changes | generate a new packet and obtain one fresh independent review |
| reviewer procedure contaminated before selection | discard that review and assign one clean reviewer; do not create intermediate review artifacts |

Do not ask three reviewers to inspect the same defect. A rejection must name the item IDs and one repair criterion; the author repairs all named items in one revision.

## Batch promotion and reporting

After the reviewers finish, the coordinator performs one promotion pass for the batch:

```sh
python3 "$BFN_ROOT/staging-production/validate_approval_ledger.py"
python3 "$BFN_ROOT/deploy_ready_to_data_content.py" --course "$COURSE" --overwrite
python3 "$BFN_ROOT/verify_bfn_promotion.py" --course "$COURSE" --expected "$CHAPTER_COUNT"
```

Report only at batch boundaries:

- chapters authored and awaiting review;
- chapters approved and deployed;
- a single concise blocker, if one actually needs a user decision.

Do not send progress updates for path searches, retries, reviewer assignment, or routine validator success.

## Definition of done

A chapter is done only when its 18-item bank has a matching worksheet hash, passing author review, one independent approval, a valid ledger entry, and a runtime-visible promoted lesson.
