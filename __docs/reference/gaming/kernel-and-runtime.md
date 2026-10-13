# Gaming Kernel and Runtime

`GameSessionHeader` is the durable identity: protocol version, session ID, lifecycle status, pinned ruleset reference/version/hash, portable experience reference/version/hash, launch surface and authority mode, revision, unsigned seed, participants, and seats.

Commands cross the authority boundary in a `CommandEnvelope` with command ID, actor, expected revision, logical time, causation, correlation, and the ruleset command. The runtime validates the envelope, rejects stale revisions, enforces command-ID idempotency, calls one `RuleModule`, increments revision once, and wraps pure rules events in recorded `EventEnvelope`s.

`RuleModule` implementations validate definitions, create initial state, handle commands deterministically, and project state for a viewer. They must not perform I/O, read wall-clock time, log, call AI, print, play audio, poll devices, or invoke a renderer.

`GameSessionCoordinator` owns create, resume, dispatch, observe, and close. Snapshot and journal ports are separate. A successful dispatch appends the command/event fact and then checkpoints the resulting snapshot; the session journal is replay truth, not an operational log.

Authority strategies are `remote`, `checkpointed-local`, and `ephemeral`. Remote Card Battle uses server authority. Piano can host a checkpointed-local coordinator while retaining MIDI and progression ownership. Fitness may implement the same protocol without moving race or safety language into Gaming.

Terminal views include `gaming-result/v1`: experience and session identity, completed/abandoned status, normalized outcome, subject scores, duration, and evidence. School, Piano, and Party Games consume this envelope instead of interpreting private ruleset state.

Fail closed: definition/rule validation, authorization, revision/idempotency conflicts, journal corruption, secret protection, and score commits. Fail open: decorative renderers, presenters, audio, AI commentary, and optional printing.
