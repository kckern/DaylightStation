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

## Scan data repair (2026-09 barcode cleanup)

`cli/health-scan-repair.cli.mjs` fixes rows written before the barcode intake gate:
re-fire duplicates (same UPC-sourced food, same meal and calories, ≤ 30 s apart), explicitly
chosen empty UPC rows (`--delete-ids`, from the report's `emptyUpc` list), placeholder
product photos (by content hash), shouting names (never a person-set name), ml-labelled
solids with a printed gram figure (`labelGrams`), and retired icon names re-iconed from a
reviewed name→slug table (`--icon-table`, kept in the private data tree, not in git) plus
the manifest `foodNames` file. Catalog entries get the same icon and name fixes. It uses the
same contract as above: dry run writes a private report; apply needs `--offline`, a new
`--backup` outside the tree, refuses if any input or file changed since the report, runs
all ledger changes through `mutateEntries` (archive months included, tombstoned deletes,
nutriday recomputed) and verifies afterwards.

```bash
node cli/health-scan-repair.cli.mjs --nutrition-dir <dir> --manifest <icon-manifest.yml> \
  --icon-table <private-table.yml> --food-names docs/_wip/plans/2026-09-22-icon-food-names.yml \
  [--delete-ids id1,id2] --report <new-report.json>
node cli/health-scan-repair.cli.mjs --apply <new-report.json> --backup <new-dir> --offline
```

`cli/health-icon-manifest-merge.cli.mjs --manifest <path> --food-names <path>` dry-runs the
`foodNames` merge; `--apply --backup <new-path>` writes it. Restart the backend afterwards.
Regenerate the scan report immediately before applying: the live ledger changes constantly.
