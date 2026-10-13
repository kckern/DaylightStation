# Korean 3-2 complete course expansion

Approved scope: all 16 source units, preserving deployed Lesson 1 content and evidence. Ten grammar-introduction units, five reviews (3,6,9,12,15), one cumulative final. Textbook/workbook transcripts and source PDFs are authoritative.

1. Author Lessons 2–16: complete primary themed vocabulary, short bilingual source-supported expression models, two alternate quiz forms. Six targets per new unit, eight per review, twenty for final. Explicit question/model mappings and feedback; cumulative resolution, focused review and subset retries use deployed behavior.
2. Verify progression with multiple linked decks: upcoming lessons locked, only current lesson on agenda, completed units kept in history. Any integration gaps get failing regressions before implementation. Preserve teacher overrides and Lesson 1 progress.
3. Build reproducible content tooling/fixtures; validate every lexicon/deck/unit/document through existing validators; publish immutable revisions; render all forms and subset retries for layout/scan QA. Preserve all Lesson 1 identifiers and files.
4. Generate missing English cue images and Korean/English speech with installed local Korean/English voices (external transfer was rejected; see implementation ruling), cache identical speech, validate audio. Add full teacher guide with source pages, register, grammar notes, pacing.
5. Independent review and appropriate tests. Install validated content; add linked decks through SetAssignments with stale-save protection, keeping existing enrollments identical. Deploy only required code changes. Live sequential agenda checks with no physical printing. Commit evidence and clean merged branch.

Approved architecture: cards -> explicit quiz -> mapped focused review -> unresolved-only retry. Initial gate requires both recognition directions plus matching. Review units integrate earlier grammar and new themed vocabulary; final covers all twenty grammar targets. Source speaking/open writing remain guided activities.

Authorization: user said "build it all" after the sixteen-unit recommendation and earlier authorized this course's commit/deployment/enrollment. Do not repeat permission gates for this expansion. Preserve unrelated root CLI and production fitness edits; no physical test print or second backend.
