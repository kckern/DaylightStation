# Card practice and paper assessments

A `school.unit/v1` can link a card-ladder enrollment to pinned paper forms through `practice` and `assessmentForms`. Assign both the course (or standalone unit) and a `flashcards` program naming the same deck and `linkedUnitId`. The combined agenda entry launches the cards; the paper assessment stays in course history without appearing as a second daily obligation.

```yaml
practice:
  programId: flashcards
  deckId: language/example/lesson-01
  requiredCardIds: [permission-card]
  questionCards:
    permission-01:
      cardIds: [permission-card]
      kind: application
      explanation: Review the permission pattern before another example.
assessmentForms:
  - print/example-a@123456789
  - print/example-b@abcdef123
document: print/example-a@123456789
passing: { percent: 100 }
retry: { variants: 2 }
```

Every form must contain exactly the mapped question identifiers. Forms should test the same targets using different examples. Every question must explicitly map to required cards. `application` questions preserve mastery on a paper miss; `vocabulary` questions also apply the existing paper demotion once per effective grade. Cards, forms, and mappings are frozen into `practice_prepared` session evidence at issuance. Authored changes apply to new lesson runs, not outstanding paper or its retry chain.

The initial gate uses the card ladder's verified mastery and matching flags for every required card. Excluding a required card does not bypass the gate. Focused retries use a separate `course-review` queue with an ungraded model followed by tasks `3.1` and `2.2`; only correct graded responses after the latest paper failure satisfy the retry requirement. A wrong check clears fresh recognition credit for that card. This queue leaves the daily plan and its completion facts intact.

Paper credits are derived cumulatively from effective graded session evidence. Corrected or invalidated grades change those credits. A finished child retry is preserved when a later correction requires another attempt; the recovery child records `remediationOf` and receives only the currently unresolved questions. Ordinary spaced-review changes do not revoke completed paper targets.

Subset identity travels through the issued render recipe and allocation record as `assessmentItemIds`. Scan reconstruction selects the same questions before deriving rows and grading. Reprints retain the issued attempt and its subset. Quiz printing remains an explicit learner action.

Routes under `/api/v1/school/lifecycle`:

- `GET /practice-assessments?learnerId=...&deckId=...`: read-only readiness.
- `POST /practice-assessments/:unitId/print`, body `{ learnerId }`: issue or reprint.
- `POST /practice-assessments/:unitId/review`, body `{ learnerId, sittingId }`: start focused checks in that learner's assigned sitting.

Deploy support for these rules before enabling a linked enrollment. An older backend treats a paper unit as ordinary printable work and does not enforce the practice gate.
