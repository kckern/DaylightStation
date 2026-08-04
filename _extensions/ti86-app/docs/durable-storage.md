# SchoolCalc TI-86 durable storage

This document defines the calculator-owned durability boundary. The backend is
authoritative for identity, content, grading, and result idempotency; the
TI-86 remains authoritative for its not-yet-acknowledged queue and its local
continuation state.

All records are ordinary TI-86 String variables. The two-byte TI String length
belongs to TI-OS and is not included in the record lengths below.

## Variable ownership

| Variable | Record | Owner | Relay access | Purpose |
| --- | --- | --- | --- | --- |
| `DSLOCAL0` | `SCL1` | client runtimes | never | alternating local-state slot 0 |
| `DSLOCAL1` | `SCL1` | client runtimes | never | alternating local-state slot 1 |
| `DSNATIVE` | `SCN1` | native runtime | never | transient exact native-settings snapshot |
| `DSCAT0` / `DSCAT1` | `SCC1` | shell | never | alternating committed Catalog snapshots |
| `DSINST0` / `DSINST1` | `SCM1` | shell | never | alternating committed complete install snapshots |
| `DSINST` | `SCM1` | shell | read-only uplink | repairable copy of the active installed-state snapshot |
| `DSQ` | `SCQ1` | `SCQUEUE` | read-only uplink | canonical unacknowledged result/progress queue |
| `DSQB` | `SCQ1` | `SCQUEUE` | never | temporary intended result queue during replacement |
| `DSQOUT` | `SCO1` | `SCQR` | never | client-private, self-reported QR-output receipt bitmap |
| `DSREQ` | `SCD1` | `SCREQ` | read-only uplink | canonical unacknowledged install/remove request queue |
| `DSREQB` | `SCD1` | `SCREQ` | never | temporary intended request queue during replacement |
| `DSUSERS` | `SCU1` | `SCPROF` | never | canonical configured learner roster plus stable device keys |
| `DSUSRNEW` | `SCU1` | relay | write-only staging | complete learner-roster replacement awaiting validation/promotion |
| `DSPROG` | `SCG1` | `SCPROF` | never | canonical all-active-learner My Progress projection |
| `DSPRGNEW` | `SCG1` | relay | write-only staging | complete progress replacement awaiting validation/promotion |
| `DSTREQ` | `SCTQ` | `SCTUTOR` | read-only uplink | one exact learner-scoped interaction request retained across retry |
| `DSTURN` | `SCTR` | `SCTUTOR` | never | last validated response/current tutor turn |
| `DSTNEW` | `SCTR` | relay | write-only staging | request-correlated interaction response awaiting promotion |
| `DSACKNEW` | `SCA1` | relay | write-only staging | server-authorized sequences awaiting shell commit |
| `DSSYNC` | `SCM1` | relay | write last | authorizes one complete staged sync transaction |

Neither `DSLOCAL*`, `DSNATIVE`, `DSQB`, `DSQOUT`, `DSREQB`, `DSUSERS`, `DSPROG`, nor
`DSTURN` is
uploaded by the relay. They are visible as ordinary variables on the
calculator, but the relay deliberately does not read or replace them.
`DSUSRNEW` and `DSPRGNEW` are one-way staged projections; the calculator owns
complete validation and canonical promotion. `DSTREQ` is a read-only uplink;
`DSTNEW` is its one-way response stage.

## `SCO1` QR-output receipt

`DSQOUT` is exactly 34 bytes: `SCO1`, format version `1`, body length `25`,
the u24 sequence of the first current `DSQ` record, 22 little-bit-order receipt
bytes (one for each of the 170 possible `DSQ` ordinals), and CRC-16/CCITT-FALSE.
F1 `DONE` on the result QR sets its current ordinal; F5 `LATER` does not.

It is deliberately **not** an acknowledgement, upload claim, grading claim, or
relay input. A stale/corrupt receipt, or one whose base sequence no longer
matches the current whole-batch queue, is discarded and results are offered for
QR again. `DSQ` remains the sole durable server-delivery authority and is
deleted only by a complete accepted/duplicate link acknowledgement.

## `SCL1` local-state record

`SCL1` is exactly 124 bytes. Integers are little-endian. A ten-byte key is
either ten RFC-4648 base32 characters (`A-Z2-7`) or ten zero bytes for none.
An index is `u16`; `$FFFF` means none. CRC is CRC-16/CCITT-FALSE over bytes
0–121.

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 4 | ASCII `SCL1` |
| 4 | 1 | format version `1` |
| 5 | 2 | body length `115` |
| 7 | 4 | monotonically increasing generation |
| 11 | 2 | flags |
| 13 | 1 | view code |
| 14 | 10 | active artifact key |
| 24 | 2 | Catalog index |
| 26 | 2 | subject index |
| 28 | 2 | course index |
| 30 | 2 | unit index |
| 32 | 2 | lesson index |
| 34 | 2 | module index |
| 36 | 2 | item index |
| 38 | 2 | focused component/item |
| 40 | 2 | view scroll offset |
| 42 | 1 | card face (`0` front, `1` back) |
| 43 | 2 | card body scroll offset |
| 45 | 1 | draft kind |
| 46 | 1 | draft byte length (`0..48`) |
| 47 | 48 | zero-padded draft bytes |
| 95 | 3 | next result sequence (`u24`) |
| 98 | 3 | next durable request ID (`u24`), shared by delivery and interaction requests |
| 101 | 1 | pending delivery action |
| 102 | 1 | native capability code |
| 103 | 1 | native handoff phase |
| 104 | 4 | native snapshot generation |
| 108 | 10 | Catalog generation key |
| 118 | 2 | remembered selected learner key (`0` is Guest) |
| 120 | 2 | immutable active-session learner-key snapshot (`0` is none/Guest) |
| 122 | 2 | record CRC |

Flag bits are session-active, draft-present, native-pending,
native-restore-needed, assessment-started, active-Catalog-slot-one,
active-installed-state-slot-one, sync-snapshot-present, delivery-pending,
result-pending, and learner-selected (a high-byte acknowledgement that makes
explicit Guest distinct from first boot). Unknown flag bits are rejected, not
silently reinterpreted.
Slot selector bits are invalid until sync-snapshot-present is set, and that flag
must agree with a non-empty Catalog generation key.

Views are Home, Catalog, Subject, Course, Unit, Lesson, Module, Result, Sync,
Native, Delivery, and Tutor. `PROFILE_VIEW_USER` is a private SCPROF entry
handoff, not a resume destination: EXIT writes Catalog root. Draft kinds are none, choice, number, text, ordering,
matching, progress, and score. Delivery actions are none, install, remove, and update.
Native capabilities are none, calculator, graph, table, solver, matrix,
equation-editor, and allowlisted native-program. Native phases are none,
snapshot-committed, configured, and restore-pending.

The decoder also enforces cross-field invariants:

- draft-present agrees with a non-empty typed draft;
- native-pending agrees with a real capability and phase;
- native-restore-needed requires restore-pending;
- every view, draft, capability, phase, index, key, and length is bounded;
- delivery-pending agrees with the Delivery view and a non-none action;
- result-pending permits only a choice or five-byte progress continuation;
- progress status is `started`, `viewed`, `completed`, or `abandoned`, with
  `position <= total`;
- delivery-pending and result-pending may not coexist;
- a session-active non-Guest learner has a nonzero session snapshot independent
  of later profile focus; and
- profile switching is refused while a session, delivery continuation, or
  result continuation is pending.

## Alternating local-state commit

`DSLOCAL0` and `DSLOCAL1` use copy-on-write generations:

1. Read and validate both slots completely.
2. Select the one valid record with the highest generation.
3. If neither variable exists, start from the deterministic Home state at
   generation zero.
4. If one slot is corrupt and the other is valid, use the valid slot and mark
   the corrupt slot repairable.
5. If both are corrupt, stop with a storage error; do not invent continuation.
6. Equal generations are impossible under alternating writes and therefore a
   conflict even when the bytes happen to match.
7. Construct generation `current + 1` in RAM, including CRC.
8. Replace only the inactive slot and read it back for exact validation.
9. The newly verified slot becomes active. The previous slot is retained until
   a later successful generation replaces it.

A complete reinstall provisions *both* slot names with the same neutral Home
continuation at consecutive generations. This intentionally overwrites any
state left by an earlier test release; provisioning only one slot is invalid
because an older installation may have a higher generation in the other slot.
Normal sync/update transactions do not reset these slots.

A power cut before step 8 leaves the old slot authoritative. A cut during step
8 leaves at least the old slot valid. A cut after verification leaves the new
generation authoritative. Generation exhaustion is a visible storage error;
it never wraps to zero.

The current Z80 shell implements the core alternating `SCL1` load/save path.
The host reference codec exercises the complete record and fault matrix. More
shell views will hydrate the fields already reserved by the format.

## `SCN1` native snapshot

`DSNATIVE` is a client-private, transient `SCN1` envelope. Its body contains a
`u32` snapshot generation, one finite native capability code, an entry count,
and canonical entries sorted by finite resource code. Each entry has a
present/absent flag, a `u16` length, and opaque original bytes. The final two
bytes are CRC-16/CCITT-FALSE over the complete header and body.

The complete record is capped at 4,096 bytes. Resource limits are 128 bytes for
the home entry, 3,072 for the TI-OS function GDB, 32 for table settings, 512
for solver state, 2,048 for matrix workspace, and 1,024 for an allowlisted
native-program workspace. Duplicate/out-of-order resources, unknown flags,
oversized entries, absent entries with bytes, truncation, trailing data, or CRC
failure are rejected.

Native handoff writes and validates `DSNATIVE` before an `SCL1` generation can
point to it. The snapshot generation and capability must then match `SCL1`
exactly. Restoration writes the original resource bytes (or repeats the
original absence), clears the native fields in a newer alternating local-state
slot, and deletes `DSNATIVE` last. An orphan with no pending `SCL1` transaction
is safe to remove. A missing/corrupt/mismatched snapshot with a pending
transaction is never guessed or silently cleared.

The snapshot is charged to the existing free reserve and never counted as
downloadable content. Preflight leaves 6,112 bytes after the snapshot and TI
variable overhead. The exact transaction and capability mapping are specified
in [`native-tool-handoff.md`](./native-tool-handoff.md).

## Catalog and installed-state snapshot commit

`DSSYNC` contains both the requested delta and `installedArtifacts`, the
complete post-commit set. A blocked plan leaves that complete set unchanged.
This prevents restart recovery from depending on an unbounded history of old
deltas.

`DSCAT0/1` and `DSINST0/1` are alternating snapshots selected together by the
slot bits in `SCL1`. `DSINST` is only a repairable copy exposed to the relay;
the selected `DSINST0/1` record remains authoritative if replacement of that
copy is interrupted.

The calculator transaction is:

1. Validate `DSID`, `DSSYNC`, the applicable staged or already-committed
   Catalog, every artifact in the complete post-commit set, and exact
   `DSACKNEW` sequences before the first mutation.
2. Write/read back the Catalog to the inactive Catalog slot when its generation
   changed.
3. Write/read back `DSSYNC` to the inactive installed-state slot.
4. Recover `DSQ`/`DSQB`, then apply the acknowledged queue transaction.
5. Write/read back the inactive `SCL1` generation selecting both new slots.
   This is the content/install commit point.
6. Publish/repair canonical `DSINST`, delete authorized removal variables, and
   clean staging variables with `DSSYNC` deleted last.

The host reference transaction injects a power cut after every durable
mutation and proves that retry converges byte-for-byte on one final state. The
Z80 translation validates and commits the same staged records; execution under
an owned-ROM emulator and the recovered fleet remains a named hardware gate.

## Learner roster and My Progress projections

`DSUSERS` is a checksum-valid fixed-layout `SCU1` roster for the attached
device. It contains a device ID, generation key, and at most 16 active
configured learners with stable positive 16-bit keys and compact labels.
Historical/retired bindings remain only on the backend so old queued work can
still be resolved without consuming calculator RAM. Guest is synthetic key
zero and is not stored as a learner profile.

The relay writes a complete candidate to `DSUSRNEW`. `SCPROF` validates the
envelope, device identity, generation, record count, unique positive keys,
labels, exact length, and CRC before replacing `DSUSERS`; the staging variable
is deleted last. On a roster change, a selected retired learner falls back to
Guest only when no session or result/delivery continuation is active.

`DSPROG` is a checksum-valid fixed-layout `SCG1` read model for all active
configured learners on the device. Each keyed profile contains bounded generic
summary counters, an optional score percent and activity date, at most one
recent score, at most two prioritized generic follow-ups, and a compact
evidence-backed curriculum-history preorder. A history node carries parent
index, structural kind, pending-evidence bit, score, activity/completion
counters, and a short label. The adapter retains at most 12 nodes per learner
and allocates at most 48 round-robin across the device, so one learner cannot
consume every shared-calculator slot. Every retained prefix contains its
parents. It contains no subject-specific behavior, no invented parent
completion, and deliberately omits Guest. The record targets 2,048 bytes and
fails above 4,096 bytes.

The relay stages the complete projection as `DSPRGNEW`. `SCPROF` validates
every nested bound and the device identity before replacing `DSPROG`, then
deletes staging last. My Progress selects the entry matching the remembered
learner key; no matching entry is shown as unavailable rather than borrowing
another learner's history. My Progress keeps all bounded nodes visible in a
two-row overview while arrows move one focus and a fixed inspector shows its
label, structural level, score, activities, completions, and pending marker. A
profile change resets only the visible Catalog
address/focus/scroll continuation so learner A's hidden indices cannot be
reused in learner B's filtered tree.

## Tutor interaction transaction

`DSTREQ` is one checksum-valid fixed-layout `SCTQ`, not a queue. It snapshots
the device ID, selected positive learner key, 24-bit request ID, client/server
sequence cursors, and exactly one action: invoke an opaque follow-up, submit an
A–E choice, or cancel a session. Guest cannot create it. `SCL1.nextRequestId`
advances only after the exact intended bytes verify; if power fails between the
variable write and state commit, restart repairs that one counter advance from
the retained record.

The relay reads `DSTREQ` without deleting it and stages a bounded `SCTR` as
`DSTNEW`. `SCTUTOR` requires its device ID, learner key, and request ID to match
the current identity, selected learner, and exact durable request before any
mutation. Promotion is copy-on-write:

1. validate the complete staged response and retained request;
2. replace and read back `DSTURN`;
3. delete `DSTREQ` only when the response disposition acknowledges it
   (`complete` or `unavailable`);
4. delete `DSTNEW` last.

`processing` and `retryable_error` retain `DSTREQ` byte-for-byte, so F1/ENTER
or a later sync resends the same logical action. EXIT pauses without canceling.
If a cut occurs after terminal request deletion but before stage deletion, the
matching committed `DSTURN` proves promotion and cleanup converges without
reissuing the action. Cross-device, cross-learner, stale-request, malformed, or
oversized responses fail closed; `SCTR` never carries the assessment answer
key.

## `DSREQ` delivery-request queue

`DSREQ` is a checksum-valid fixed-layout `SCD1` envelope owned by `SCREQ`. Its
body is one short ASCII device ID, a `u8` record count, and ordered request
entries. Each entry is a `u24` request ID, a snapshotted `u16` learner key, an
action byte, and a short ASCII target. Install targets are canonical
five-segment lesson addresses; remove targets are ten-character immutable
artifact keys. An Update UI action expands to an ordered install plus remove
pair using the same learner snapshot. The queue is capped at 2,048 bytes and
32 entries; its planning allowance is 512 bytes.

Key zero means an explicit Guest request; positive keys must resolve to an
active binding at first claim. The backend authorizes every new target against
the learner-scoped Catalog projection before compiling or changing desired
state, and preflights the whole batch so a later invalid entry cannot leave an
earlier mutation behind. An already-persisted byte-identical request remains a
safe duplicate even if the learner is later retired or assignment changes.

`nextRequestId` is independent of the result `sequence`. It advances only after
the exact intended `DSREQ` verifies. Existing IDs must be strictly increasing;
an identical retry is a no-op and changed content at one ID is a conflict.

Append uses the same backup-first transaction as the result queue, with
`DSREQB` as the private intended record: recover both candidates, write and
verify `DSREQB`, replace and verify `DSREQ`, then delete `DSREQB`. `SCREQ` also
checks the delivery-acknowledgement suffix in the committed `SCM1`. It deletes
`DSREQ` only when those IDs exactly equal the complete ordered queue. A partial,
reordered, or unrelated acknowledgement retains the queue byte-for-byte for
idempotent replay; no partial compaction allocation is needed.

## `DSQ` result/progress queue

`DSQ` is a checksum-valid fixed-layout `SCQ1` envelope with one device ID, a
`u16` record count, and ordered length-prefixed records. It is deliberately not
the generic typed-document codec: each element is the exact immutable `SCR1`
byte string used by QR and cable import. The hard calculator bound is 6,144
bytes.

Append rules:

1. Decode and validate the new `SCR1` completely.
2. Require its device ID to equal the queue's device ID.
3. Require existing sequences to be strictly increasing; if the new sequence
   is absent, append one exact length-prefixed byte string.
4. If the same sequence already contains identical bytes, return the existing
   queue unchanged.
5. If the same sequence contains different bytes, stop with a conflict.
6. Patch only the record count and envelope body length, recompute CRC, then
   decode the complete candidate before committing it.
7. Never show local completion feedback or a QR result until the durable append
   has committed.

The sequence is a 24-bit counter owned by `SCL1`. It advances only with the
successful queue transaction. Re-enrollment must rotate the device identity
before sequence zero can be reused.

`SCR1` v1 deliberately contains no timestamp. The TI-86 has no RTC; its
hardware interrupt can measure active-session duration but cannot establish
civil time or advance reliably through every off/reset condition. Sequence is
therefore the exact device-local ordering fact. The backend records a canonical
`receivedAt` for each QR/cable arrival and retains the first import `startedAt`
across retries. The normative time contract is
[`time-model.md`](./time-model.md).

## Queue replacement through `DSQB`

Appending or compacting can change the size of a TI String, so `DSQ` cannot be
safely edited in place. A non-empty intended queue commits in this order:

1. Delete any stale `DSQB` only after recovery has inspected it.
2. Write the complete intended queue to `DSQB`.
3. Read back and validate its device ID, envelope, ordering, nested fixed
   `SCR1` records, bound, and exact bytes.
4. Replace `DSQ` from the verified intended bytes.
5. Read back and validate `DSQ` exactly.
6. Delete `DSQB`.

Recovery inspects both variables before any deletion:

- valid `DSQB` is the pending intended state and wins;
- valid equal `DSQ` + `DSQB` means commit completed and only backup cleanup is
  required;
- corrupt `DSQB` with valid `DSQ` is discarded;
- invalid/missing `DSQ` with valid `DSQB` promotes the backup;
- no valid candidate is a visible storage failure.

An acknowledgement that removes every record may delete `DSQ` directly after
stale-backup recovery. A cut before deletion resends idempotent duplicates; a
cut after deletion is already the intended empty state.

## Acknowledgement and QR/cable convergence

The backend ledger key is `{deviceId, sequence}` plus the immutable record
digest. It returns:

- accepted for a new valid record;
- duplicate for the same key and exact bytes;
- conflict for the same key and different bytes.

Only accepted or byte-identical duplicate sequences may appear in `SCA1`.
`DSACKNEW` is staging, not authority. The shell applies it only when the final
`DSSYNC` manifest matches the complete transaction. v0 acknowledgement is
whole-batch: the exact ordered sequence list must equal every record in `DSQ`.
A partial, reordered, or unrelated list leaves the entire queue byte-identical;
an exact match authorizes deletion of the complete queue.

Scanning a QR first and later uploading `DSQ` by cable therefore produces one
logical result with two arrival records and two backend `receivedAt` values.
The cable import is duplicate and may be acknowledged safely. A lost
acknowledgement merely causes another safe replay.

## Fault matrix

| Fault point | Recoverable authoritative state |
| --- | --- |
| local-state write not started | previous active `DSLOCAL*` |
| inactive local-state slot torn | previous valid slot |
| both local-state slots corrupt | stop; preserve queue/content |
| queue candidate exceeds 6 KiB | old `DSQ`; no success feedback |
| `DSQB` write torn | old valid `DSQ` |
| power cut after verified `DSQB` | promote `DSQB` |
| power cut after `DSQ` replacement | equal `DSQ`/`DSQB`; delete backup |
| `DSREQB` write torn | old valid `DSREQ` |
| partial delivery ACK | retain exact `DSREQ` batch |
| QR accepted before cable sync | later cable import is duplicate |
| upload succeeds, ACK is lost | `DSQ` replays safely |
| ACK has wrong device/invalid or partial sequence list | reject or retain all records |
| same sequence has changed bytes | conflict; never acknowledge/remove |
