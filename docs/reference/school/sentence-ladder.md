# Sentence Ladder

Sentence Ladder names the pedagogy, not the content vendor. Each sentence moves
through repetition, dictation, recording, and interpretation on successive
4am-to-4am study days. The queue is derived from append-only attempt evidence;
it is never stored as mutable queue state.

The canonical program id and endpoint are `sentence-ladder` and
`/api/v1/school/sentence-ladder`. `language` remains a deprecated compatibility
alias for old assignments and clients. Glossika remains only in legitimate
provenance: corpus ids, the recovered dump adapter, and the import CLI.

Every learner endpoint requires a short-lived HMAC study grant issued by a
validated School launch. It is bound to learner, corpus, program purpose, and
expiry and is carried in `X-School-Study-Grant`. Course metadata and prompt
audio remain public; progress, attempts, pacing, history, rollover, and
recordings require the grant. The browser holds it in memory, so a pasted URL
or refresh cannot create authority. Grant-bearing DoNow launches use
`never_ask`, because a pending approval persists its action; the launch must
dispatch immediately or refuse rather than persist the grant.

Writes are server-authoritative. A generic attempt cannot claim recording
credit, and all attempts must match an outstanding entry in the current queue
under the current gate and device capabilities. Recordings validate the same
queue before audio is persisted.

## Enrollment options

`programs[]` enrollment records may set `dictationMode: copy`. This reveals one
target-script glyph ahead of the learner's matching typed prefix, while the
target-language prompt audio loops after the learner presses Play or starts
typing. It supports script-entry practice before a learner can transcribe from
audio alone. The default (`listen`) remains audio-only dictation. The mode is
resolved by the server and is not learner-controlled.

The frontend requires explicit learner, corpus, and grant. It cancels stale
loads, re-derives after each write, and directs a learner to a capable device
when an enrollment-owned credit rung cannot be completed locally.

## School lifecycle

On a locked Portal, the learner enters through the anonymous self-service
keypad. Resolving the code claims the learner; the program action carries the
corpus and an in-memory study grant into the ordinary School launch path. The
runner then offers only the repetition, dictation, recording, and
interpretation work that is both due and supported by that device.

Each accepted step appends evidence and the runner re-fetches the derived day.
It emits one structured `school.language.program.progress` diagnostic for each
observable `(day, done, total, blocked)` state and shows the same saved-step
progress to the learner. The payload also identifies an `empty` queue so a
no-work day is distinguishable from an ordinary completed set. A locked runner
says `Leave for now` while work is outstanding or blocked by device capability;
`Done` appears only after the full credit chain is complete, or when no work is
due at all.

Completing an enrollment-owned day publishes
`school.language.day-complete`. `CloseLanguageDay` settles the deterministic
School program session through the standard outcome/reward path, which in turn
publishes `school.session.outcome-recorded`; `SchoolCompletionBridge`
recomputes and emits `school.completion.state-observed`. Canonical
`sentence-ladder` and legacy `language` identifiers are treated as equivalent
at this settlement boundary so migrated assignments cannot lose credit or a
configured reward.
