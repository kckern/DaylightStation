# Voice memo transcription recovery handoff

## Problem

The fitness voice-memo flow currently treats transcription as a prerequisite for
keeping the recording. It captures audio in the browser, sends it to the
transcription provider, and persists the transcript only after a successful
response. When the provider is unavailable, the recording can disappear before
it can be retried.

This makes a temporary provider outage a permanent data-loss event. It also
makes the user-facing result misleading: a memo can appear to have been
recorded, while neither audio nor transcript remains available to staff.

## Incident evidence

Two independent failure modes were observed in the latest group workout:

1. A recording reached the transcription provider and received HTTP 429. A
   controlled provider check confirmed `insufficient_quota` /
   `credit_balance_exhausted`; the configured key was accepted. The old error
   log retained only a generic message, so it could not distinguish quota,
   authentication, network, or malformed-audio failures.
2. A later recording inherited a cancellation flag from the previous failed
   upload. Its recorder stop callback discarded the audio before making a
   provider request. The fitness session stored no transcript and no raw-audio
   backup.

The recorder cancellation bug and provider error diagnostics have since been
fixed in code, but the recordings from this incident are unrecoverable. The
provider account still requires credits before a new transcription can succeed.

## Required behavior

Audio capture and transcription must be separate durable stages:

1. On stop, finalize the audio and persist a retryable recording artifact before
   or while attempting transcription.
2. Mark the artifact with a lifecycle state such as `pending`, `processing`,
   `retryable`, `transcribed`, `expired`, or `permanently_failed`.
3. If transcription fails for a retryable reason, retain the audio and schedule
   a bounded retry. Record the provider status and allowlisted error
   classification, never credentials, request headers, raw response bodies, or
   audio contents in logs.
4. If transcription succeeds, persist the transcript and associate it with the
   memo. Delete or securely purge the raw audio according to the retention
   policy, unless an explicit product policy requires retaining it.
5. If the artifact expires or reaches its retry limit, preserve a staff-visible
   failure record explaining that the audio expired or could not be transcribed.
6. Cancellation must apply only to the capture that was cancelled. A new
   recording must get a new generation/identity and must not inherit the prior
   recorder's cancellation state or callbacks.

## Storage and privacy constraints

Raw voice recordings are personal data. They must not be written to the Git
repository, browser logs, VictoriaLogs, analytics events, or ordinary debug
directories. Store them in application-private storage with access controls,
bounded retention, integrity metadata, and a cleanup job. The metadata should
contain only what recovery needs: an opaque recording ID, session correlation,
timestamps, media type/size, checksum, attempt count, next-attempt time, and
sanitized failure classification.

The retention duration, encryption-at-rest mechanism, maximum artifact size, and
staff recovery interface require an explicit product/security decision before
production rollout. Until then, do not silently retain unlimited recordings.

## Observability requirements

Emit structured lifecycle events for each opaque recording ID:

- capture finalized (size, duration, checksum, storage result)
- transcription queued, started, retried, succeeded, or failed
- provider status, error type/code, request ID, and retryability
- artifact purged, expired, or moved to permanent failure

Logs must never include the audio bytes, transcript contents, API key, request
headers, or unredacted provider response. A staff screen should show whether a
memo is recorded, awaiting transcription, transcribed, or unavailable, rather
than reporting only “failed.”

## Acceptance criteria

- A synthetic recording remains available after a simulated provider 429 and is
  successfully retranscribed after the provider recovers.
- A network timeout, authentication failure, malformed audio response, and
  quota exhaustion are classified separately, with only retryable classes
  scheduled automatically.
- A cancelled recording cannot upload, and its queued callbacks cannot affect a
  subsequent recording.
- Successful transcription removes the raw artifact according to the approved
  retention policy and leaves the transcript linked to the memo.
- Restarting the backend does not lose pending artifacts or duplicate retries.
- Recovery and cleanup tests prove that expired artifacts are removed and that
  no raw audio or transcript content enters structured logs.

## Handoff sequence

1. Choose the private storage, retention, encryption, size, and staff-recovery
   policies.
2. Implement the durable artifact repository and lifecycle state machine.
3. Add a retry worker with backoff, idempotency, and crash recovery.
4. Connect the recorder and transcription service to that repository.
5. Add the lifecycle telemetry and staff-visible status.
6. Run the synthetic failure/recovery tests and a new end-to-end memo after the
   provider account has credits.

The existing recorder cancellation and provider-diagnostic changes are a
prerequisite, not a substitute for durable audio retention. Deployment should
not be considered complete until the acceptance criteria above pass.
