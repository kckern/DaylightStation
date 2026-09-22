# Libby Identity Renewal — Design

**Date:** 2026-09-22
**Status:** Design, not yet implemented

## Problem

The Libby integration authenticates with a chip **identity JWT** stored at
`data/users/<user>/auth/libby.yml` and read fail-closed by
`LibbyCredentialProvider`. The token has a **~7-day lifetime**.

Today nothing refreshes it, so a person re-pastes a fresh token weekly. Worse,
renewal requires a *live* bearer: once the identity lapses there is no automated
recovery, and the only way back is re-pairing from the Libby app on a phone.

The work began as a request for a "passkey to JWT exchange." That turns out to be
both unnecessary and infeasible:

- The stored Libby passkey is a **WebAuthn credential in 1Password**, whose private
  key is non-exportable by design. `op` 2.31.1 exposes no passkey, WebAuthn, or
  assertion command, so nothing headless can use it.
- No passkey is needed anyway, because Libby already offers a renewal path.

## Finding: Libby has an official renewal call

From the official web client (`dewey-22.1.1`), `Sentry#acquireChip`:

```js
s = { c: "d:" + clientVersion, s: "0" }
if (chip) s.v = chip.split("-")[0]
POST /chip?c=d:<version>&s=0&v=<chipPrefix>
Authorization: Bearer <current identity>
```

The provider returns the **same chip** with a fresh identity.

Two details matter:

- **`v` is required.** It is the first dash-delimited segment of the chip id —
  the chip id is the `chip.id` claim in the token, a 36-char UUID, so `v` is its
  leading 8 characters. It tells the server "refresh the chip I already hold."
  Omitting it mints an unrelated, empty, card-less chip — verified experimentally.
- **The client guards the response.** `Sentry#_onChip` has an explicit
  "rejecting chip replacement" branch that discards a response whose chip differs
  from the current one. We must replicate that guard.

The complete chip surface in the client bundle is `chip`, `chip/clone`,
`chip/clone/code`, `chip/sync`, `chip/revoke`, `chip/stash/`, `chip/migrating/*`,
and `chip/notifying/*`. There is **no** `chip/renew` or `chip/refresh`; renewal is
`POST /chip` with the parameters above.

## Non-goals

No passkey ceremony, no account password, no browser automation, no new provider
surface. This replays one call the official client already makes, using the
account's own existing credential. The compliance boundary documented in
`docs/reference/media/integration.md` is otherwise unchanged — only its claim that
the JWT "is an input credential, not a refresh mechanism" is factually wrong and
must be corrected.

## Design

### Triggers — deliberately not a cron job

Renewal must be **usage-independent**: the failure case is precisely "nobody
played an audiobook for a week." That needs a clock, but not the cron subsystem.

1. **Self-arming timer (primary).** On composition, decode the token's `exp`,
   compute the delay until the token is ~24h old, and `setTimeout` to it. Re-arm
   from the new `exp` after each renewal. `setTimeout` caps near 24.8 days, well
   above a 7-day token.
2. **Renew-on-read (secondary).** `LibbyCredentialProvider.getSnapshot()` already
   decodes `exp` on every read. If the token is past the threshold, kick a
   renewal. Free, and covers a timer lost to a crash.
3. **Startup check.** One evaluation when the module composes, covering time the
   host spent powered off.

`AgentAssignmentScheduler.registerTask()` was considered and rejected: its loop is
gated to Docker or `ENABLE_CRON=true`, so it would never fire in development, and
a fixed cron expression knows nothing about the token's actual remaining life. The
timer derives its schedule from the credential itself and is therefore
self-correcting.

**Eager, not lazy.** Renew whenever the token is over ~a day old rather than
waiting for near-expiry. Remaining life then always sits between roughly 6 and 7
days instead of sawtoothing toward zero, which maximizes the tolerated outage
window at a cost of a few requests per day.

### Components

| Component | Layer | Responsibility |
|---|---|---|
| `LibbyClient.renewIdentity()` | `1_adapters` | Issue the `POST /chip` call; already owns `#apiBase`, `#requestJson`, and bearer plumbing |
| `LibbyIdentityRenewalService` | `3_applications` | Orchestrate read → renew → validate → persist → invalidate |
| Credential writer | `1_adapters` | Atomic temp-file + rename against the same YAML |
| Renewal timer | `5_composition` | Arm, re-arm, and dispose alongside the Libby module |

`LibbyCredentialProvider` already keys its cache on inode/size/mtime, so a
rewritten file is picked up with no restart. The hot-reload seam exists; it has
simply never had a writer.

### Single writer

Renewal runs in exactly one process. The credential file lives in the shared
data tree, so a second renewer would produce conflicted copies and could race a
rotation. No fallback renewer on secondary machines; they read what the primary
produces.

### Safety guards

1. **Chip mismatch rejects the response.** If the returned chip differs from the
   current chip, do not persist — log an error and keep the existing token. This
   is the guard that prevents silently trading a loan-bearing identity for an
   empty one, whose symptom would be an unexplained "no loans" a week later.

   Chip equality is the *only* reliable signal here. The renewal response carries
   `syncable:false, primary:false` even on a correct, card-bearing renewal, so
   those fields must not be used to judge the response — an earlier reading of
   them as an "empty chip" marker was wrong.
2. **`exp` must strictly advance** over the current token.
3. **The new token must parse** as a JWT with a finite `exp`.
4. **Atomic write**, retaining the prior token as a backup field.
5. **Single-flight.** Concurrent triggers collapse to one in-flight renewal.
6. **Never log token material** — no tokens, chip ids, or signed URLs in logs or
   API metadata, consistent with the existing adapter rule.

### Observability

Structured events for attempt, success (with the new expiry only), and each
distinct failure. If remaining life ever falls below ~3 days, renewal has already
failed repeatedly: emit at `error` and route it through the notification stack in
`5_composition/notifications.mjs`. A token that dies unnoticed is
indistinguishable from a broken integration, so the alarm must precede the
failure, while a small fix still suffices.

### Recovery

If the identity lapses anyway — the host was off longer than the token's
remaining life — recovery is the `chip/clone/code` pairing ceremony: generate an
8-digit code in the Libby app and supply it once. This belongs in the runbook now,
while the mechanism is understood, so it is a 30-second operation later rather
than a fresh investigation.

## Verified by live test (2026-09-22)

One real renewal was executed against the live account:

- **Renewal works.** `POST /chip?c=d:22.1.1&s=0&v=<8-char prefix>` returned `200`
  with the **same chip** and a new identity. `chip/sync` on the new token returned
  the full account — 1 card, 3 loans.
- **Renewal resets the window to a full 7 days from now**, not a fixed extension
  of the old expiry. This is what makes eager renewal worthwhile: renewing daily
  keeps remaining life pinned near 7 days indefinitely.
- **The prior identity is NOT invalidated.** The old token still returned `200`
  with its cards after the renewal. So there is no rotation hazard and no
  sync-lag window where a secondary reader holds a dead token. Overlapping
  validity also makes the write non-urgent and safely retryable.

## Open questions

- **Client version string.** `c=d:<version>` is pinned to the observed client
  build (`22.1.1`), which worked. Whether the provider rejects or degrades on a
  stale version is untested. Decide whether to hardcode, make it configurable, or
  read it from the app shell.

## Testing

Test-driven, with unit coverage per guard against a fake gateway: chip mismatch,
non-advancing `exp`, malformed token, network failure, and concurrent triggers.
A live test, gated like the existing `test/live/libby-bootstrap.live.mjs`, exercises
one real renewal end to end.

## Documentation to update

`docs/reference/media/integration.md`, "Authentication and expiry" — replace the
claim that the JWT is not a refresh mechanism with the renewal behavior, retain
the fail-closed and no-logging rules, and add the `chip/clone/code` recovery path.
