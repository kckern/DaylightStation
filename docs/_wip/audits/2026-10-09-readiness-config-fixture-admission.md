# School recipe fixture admission

The isolated read-only runner now accepts a JSON array at exactly
`data/content/school/generated-banks/recipes.yml`. All previously reviewed array
paths retain their existing admission rules. Sibling datasets, alternate names,
`.yaml`, traversal, and raw recipe destinations remain excluded.

The actual source consumer is `GeneratedBankSource`: its constructor reads the
recipe array, and `listSummaries()` projects metadata. `SchoolService` filters the
summaries by collection; the Geography GET renames `summaryId` to `deckId`.
This fixture admission does not grant dataset reads, generated-bank resolution,
API mutations, provider/device activity, or writable backing. Product code is
unchanged.

The focused config controls first reproduced the recipe-array rejection. They
then passed after the exact destination exception, including negative path/raw
controls and old-versus-new parity across 60 existing path/value combinations.
All 52 readiness control tests passed. The initial failed isolated execution is
preserved in private run records; prepared cases do not receive execution credit.
Changed harness pins require fresh reviewed admission before another capture.
