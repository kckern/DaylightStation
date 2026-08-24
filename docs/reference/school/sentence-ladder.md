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

The frontend requires explicit learner, corpus, and grant. It cancels stale
loads, re-derives after each write, and directs a learner to a capable device
when an enrollment-owned credit rung cannot be completed locally.
