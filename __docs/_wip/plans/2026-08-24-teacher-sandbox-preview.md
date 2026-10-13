# Teacher sandbox preview

## Purpose

Teacher exploration is not learner activity. A teacher must be able to inspect
published course material and try an interactive program without creating an
assignment, session, printed artifact, result, progress row, recording, or
DoNow dispatch.

The UI must name this mode **Preview** or **Try as guest**. It must never make
a preview look like a learner's history.

## Two entry points

### Student agenda

The learner workspace must let a teacher select any valid **study day** and
inspect the planned agenda as data or a rendered image. This is planning, not
issuance:

- the selected `YYYY-MM-DD` is resolved using the household's study-day
  boundary (including DST), rather than treated as a UTC calendar date;
- it uses the dry-run agenda builder, whose session and token writes are
  no-ops and which does not mint or render an agenda ticket at all;
- the response is `private, no-store` and names itself
  `X-School-Preview: agenda-non-recording`;
- it contains no QR or digit code, usable or otherwise;
- this planning surface has no print/issue action for any date.

The workspace defaults to the current study day; changing the date lets a
teacher inspect tomorrow or another day without changing any learner record.
Issue/print remains a separate, explicit workflow, never an escalation from
this preview. The study day is resolved by the server's household boundary,
not the browser's calendar, including the 4am rollover and DST.

## Immutable issued artifacts

An artifact is exact only when its retained bytes are present. Teacher history
may show the original PDF/receipt, a thumbnail derived from those retained PDF
bytes, download, and reprint for that record. It must never rebuild a worksheet
or receipt from current curriculum and label it as historical.

The issuance path follows the same rule: a rescan/reprint uses the retained
artifact bytes directly. If an older session predates retention and its source
bytes are absent, the system returns an explicit original-unavailable notice;
it does not render current data under the old artifact ID. A correction or
regrade is a separate, newly captured artifact with its own lineage.

### Lesson material

From a published lesson in Teacher > Curriculum, **Preview worksheet** opens
the published document in a new tab. It is a representation of the published
source, not an issued worksheet:

- no learner, card, allocation, artifact, printer, or token is supplied;
- the response is private and `no-store`;
- the renderer is rejected if it reports an allocation;
- an answer-key variant may be added as an explicit teacher-only choice.

The implementation is `PreviewTeacherLessonMaterial`. It is intentionally
separate from the issuing path, so a future issuing feature cannot silently
turn preview traffic into history.

### Sentence Ladder

**Try Sentence Ladder as guest** will launch a separate, stateless runner for
a selected published corpus. It must use a dedicated preview-day read model:

- the queue is derived from the corpus and an empty in-memory attempt log;
- completing a rung changes only browser memory for that open tab;
- it never calls learner `/users/:userId/*` endpoints, receives a study grant,
  writes progress/attempts/recordings, or dispatches DoNow;
- refresh deliberately starts the preview again; there is no resume/history;
- the screen plainly says `Guest preview — nothing is saved` and offers Exit.

This must not reuse the learner launcher. That launcher intentionally requires
a learner-scoped, in-memory study grant and exists precisely to make learner
study auditable.

Implemented route: `/school/sentence-ladder-preview/:corpusId`. Teacher >
Curriculum exposes each published corpus under **Try as guest**. Its day is
provided by `GET /api/v1/school/sentence-ladder/preview/:corpusId/day`, whose
read model starts from an empty in-memory event log. The endpoint has no grant
or user parameter and is `private, no-store`; the browser completes steps in
component state only.

## Required acceptance checks

1. Opening a worksheet preview performs no issue, print, artifact, or write.
2. The worksheet preview has no allocation/card identifier and is not listed
   in teacher or learner history.
3. Guest Sentence Ladder receives no learner ID or study grant and cannot
   invoke any persistent language endpoint.
4. Refreshing/exiting a guest preview leaves the progress store, event log,
   recordings, artifact store, and DoNow log unchanged.
5. The teacher interface distinguishes Preview from Issue/Print with exact,
   non-ambiguous labels.
6. A future agenda preview does not create an agenda artifact, work session,
   token, QR/digit credential, dispatch receipt, or printer request.
