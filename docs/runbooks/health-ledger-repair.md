# Health ledger repair

Use `cli/health-ledger-repair.cli.mjs` for an explicit, evidence-backed conversion
of a user's existing nutrition ledger. This is not a startup task.

## Safety contract

- Resolve one exact user's nutrition directory from the configured data root.
- Stop **all** nutrition writers before applying: production, dev backend, jobs,
  and any maintenance scripts. The store's journal is single-process, not a
  distributed lock. `--offline` is an operator assertion, not automatic fencing.
- Run the deployment activity gate before any service interruption. A failed or
  unavailable gate halts the operation.
- Preserve unknown mass. Never estimate historical grams from servings, cups,
  tablespoons, calories, or an assumed 100 g portion.
- The planner retains explicit mass and gram-unit quantities. It can borrow
  capture mass only with matching ID, name, unchanged nutrient snapshot, and
  preserved original quantity evidence. It does not certify old AI estimates.
- This conversion changes quantity representation, schema/version metadata and
  derived summaries, **not nutrient totals**. It does not merge foods or rewrite
  uncertain catalog observations. Review ambiguous catalog definitions explicitly
  in Saved foods; that affects future logs only.

## Dry run and rehearsal

```bash
node cli/health-ledger-repair.cli.mjs \
  --nutrition-dir <exact-user-nutrition-directory> \
  --report <new-private-report.json>
```

The report contains private food records: keep it outside the repository. It
includes SHA-256 hashes of all nutrition YAML, proposed field changes and
unresolved IDs/reasons. Binary macOS `._` sidecars are not YAML and are ignored.
Real malformed YAML stops inspection. Missing/duplicate IDs and invalid dates
require review; do not attempt to invent replacements.

Copy the entire nutrition directory to a new temporary rehearsal directory.
Generate a new report against that copy and apply it there with a separate,
previously nonexistent backup directory. Confirm row counts, nutrient totals,
archive preservation, restored summaries, and a second dry run with zero
proposed changes. Unit fixtures alone are not a production-data rehearsal.

## Apply

After the gate is clear and every writer is stopped, generate/review a fresh
report, then:

```bash
node cli/health-ledger-repair.cli.mjs \
  --apply <reviewed-private-report.json> \
  --backup <new-private-backup-directory> \
  --offline
```

Apply refuses a changed manifest or existing backup directory. It copies every
YAML file, verifies backup hashes, stores the manifest with the backup, and only
then performs the journaled mutation. Backups must be outside the live nutrition
tree. Record the exact backup location in the private deployment log.

Validate a fresh dry run (zero changes), day/range reads, and application health
after restarting. An unresolved mass count is expected, not a failed conversion.

## Recovery / rollback

Keep writers stopped on failure. If a ledger transaction is prepared, the new
store replays it before reading; do not manually edit or partially delete its
journal. To roll back the conversion, verify the backup manifest and restore
the **whole** nutrition YAML snapshot, including archives, summaries, and any
preexisting operation/tombstone metadata. First move the failed nutrition
directory to a separately named recovery location; do not overlay only the hot
file or leave a new journal next to old data. Restore required ownership before
starting the application. Nothing in this tool deletes the original backup.

Code rollback alone is not data rollback. Older application code does not share
the new ledger's replay/tombstone contract; coordinate both deliberately.
