# Unknown NFC cards never reach the observed ledger

**Date:** 2026-08-14
**Severity:** Medium — no data loss, but card enrolment is impossible without reading raw logs
**Status:** Diagnosed, not fixed

## Symptom

`data/household/history/triggers/nfc.observed.yml` has not been written since
**`2026-07-12 00:49`**. Its last entry is the `deadbeef` test UID. File mtime and
last entry agree.

Meanwhile the reader is working. On 2026-08-14 eight taps were ingested across two
sessions (`09:28:24`–`09:28:32` and `09:36:35`–`09:36:50`), all `NTAG 215` on reader
`study-omr`, all visible as `omr.ingest.nfc` in the logs. Of the four distinct cards,
one was registered and resolved correctly; the other three left **no trace anywhere
except the raw log stream**.

This is the ledger whose entire purpose is to surface an unknown card's UID so it can
be registered. Registering three cards today required reading `docker logs` by hand.

## Root cause

`backend/src/5_composition/modules/nfcTapIngress.mjs:86-92`:

```js
// Not a school card. Hand it to the normal trigger pipeline so a book
// sticker tapped on this reader behaves as it does on every other reader —
// including the unknown-tag notify path that makes enrolment possible.
if (!triggerDispatchService?.handleEvent || !location) {
  logger.debug?.('nfc.tap.unrouted', { reader: id, uid: canonical, hasLocation: !!location });
  return { status: 'unrouted' };
}
```

`location` is **null in production**. The boot line proves it:

```
"event":"nfc.tap.ingress.ready","data":{"topics":["omr"],"location":null,"school":true,"trigger":true}
```

It is sourced at `backend/src/app.mjs:3656`:

```js
location: configService.getHouseholdAppConfig?.(householdId, 'school')?.lifecycle?.nfcLocation ?? null,
```

So `school.yml` has no `lifecycle.nfcLocation`, the guard short-circuits, and every
unregistered tap returns `unrouted` **at `debug` level** — invisible at the production
log level. The observed-store write lives further down that same abandoned path
(`YamlTriggerConfigRepository:142-145`, `:176`, delegating to
`YamlObservedStateStore.record`), so it is never reached.

The code comment states the intent exactly — "the unknown-tag notify path that makes
enrolment possible" — and that is the path being skipped.

**Nothing is broken in the writer.** `YamlObservedStateStore` is fine; it simply is
never called for taps arriving via the OMR relay.

## Why it started on 2026-07-12

Not yet confirmed. The likely candidates are the introduction of the OMR-relay NFC
ingress (which routes `study-omr` through `nfcTapIngress` rather than the older
trigger path) or the loss/rename of `lifecycle.nfcLocation` in `school.yml`. Confirm
with `git log -S nfcLocation` and by checking whether `school.yml` ever carried it.

## Fix options

1. **Set `lifecycle.nfcLocation` in `school.yml`** (data-only). Restores the intended
   routing, so unknown cards flow to the trigger pipeline and get recorded. Verify the
   value matches a real location id in the trigger registry, or dispatch will fail
   downstream for a different reason.
2. **Record the observation before the routing guard** (code). Arguably where it
   belongs: observing that a card exists is not the same act as dispatching it, and
   should not depend on a location being configured. An unknown card is worth
   remembering even when there is nothing to do with it.
3. **Raise `nfc.tap.unrouted` from `debug` to `warn`.** Independent of the above. A
   tap that reaches the system and is deliberately dropped should not be invisible at
   production log level — that invisibility is why this went unnoticed for a month.

Recommended: **2 + 3**. Option 1 alone leaves the ledger dependent on unrelated
configuration, and leaves the silent-drop hazard in place for the next reader that
arrives without a location.

## Acceptance

- Tapping an unregistered card writes a `first_seen`/`last_seen`/`count` entry to
  `nfc.observed.yml` with no location configured.
- Tapping it again increments `count` and moves `last_seen`, leaving `first_seen` alone.
- A registered school card still resolves and prints, and is unaffected.
- A dropped/unroutable tap is visible at production log level.

## Reproduction

```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/history/triggers/nfc.observed.yml'
sudo docker logs --since 2h daylight-station 2>&1 \
  | grep -E '"event":"(omr\.ingest\.nfc|nfc\.tap\.[a-z_]+)"'
```

Tap an unregistered card; observe `omr.ingest.nfc` in the log and no change to the
file's mtime.

## Related

Card registry (corrected 2026-08-14, colours verified by scan order):
`data/household/config/triggers/bindings/nfc/cards.yml` — red/learner4, yellow/learner3,
green/learner2, blue/learner1. Note that `loadRegistry` runs once at boot
(`triggerApi.mjs:61`), so edits to that file need a container restart.
