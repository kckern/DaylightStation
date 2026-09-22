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

- **Deletes:** re-fire duplicates (same UPC-sourced food, same meal and calories,
  ≤ 30 s apart; the report names the kept sibling and the delay) and explicitly
  chosen empty UPC rows (`--delete-ids`, from the report's `emptyUpc` list).
- **Rows:** placeholder product photos (by content hash) cleared; shouting names
  normalized (never a person-set name; `RENAMES` in the CLI holds the explicit
  corrections); ml-labelled solids with a printed gram figure (`LABEL_GRAMS`)
  converted to grams, except where a person set the portion or the stored serving
  is not ml (both listed as `mlUnresolved`).
- **Icons:** manifest aliases map to the offered icon sharing their path (same
  picture) and are otherwise kept; retired flat-set names are re-iconed from the
  reviewed name→slug table plus the `foodNames` file, else `default`. The report
  counts what fell through to `default` per retired slug.
- **Catalog:** the same icon rules (no table hit gives `null`, never `default`),
  name normalization (collisions skipped and reported), and remembered ml portions
  (`usageByBucket.*.quantity`) converted with the label grams.

`--icon-table` is **required** (dry run and apply): without the reviewed table every
retired icon would fall through to `default`. The table lives in the private data
tree, not in git.

```bash
node cli/health-scan-repair.cli.mjs --nutrition-dir <dir> --manifest <icon-manifest.yml> \
  --icon-table <private-table.yml> --food-names docs/_wip/plans/2026-09-22-icon-food-names.yml \
  [--delete-ids id1,id2] --report <new-report.json>
node cli/health-scan-repair.cli.mjs --apply <new-report.json> --backup <new-dir> --offline
```

Apply order and checks:

1. Refuses unless the data, inputs and plan are byte-for-byte what the report
   reviewed; copies every nutrition YAML to the new `--backup` (outside the tree)
   and verifies each copy.
2. Builds and validates every catalog change in memory (entry exists, no rename
   collision) before anything is written.
3. Commits the ledger through `mutateEntries` (hot file and archive months in one
   journaled transaction, deletes tombstoned). Daily summaries (`nutriday`) change
   only for dates that lost a row; every other date keeps its stored summary.
4. Writes the catalog once, then verifies the same ids in the same order and that
   nothing outside icon, pin, name and remembered portion changed.
5. Re-plans: nutrition on surviving rows unchanged, row count as planned, nothing
   left to do. The result (including every `nutriday` change) is written to
   `<backup>/scan-repair-result.json`.
6. Moves the abandoned `food_catalog.yml.tmp-*` into `_backups/` when it is older
   than the live catalog and `lsof` shows no local holder.

**`--offline` is the real guard.** Prod and this laptop share the Dropbox data tree,
and `lsof` on the laptop cannot see the prod container's processes. Stop every
nutrition writer first — the prod container included — and only then pass
`--offline`.

**Restore:** with writers still stopped, copy the backup's files back over the
nutrition directory (`cp -R <backup>/. <nutrition-dir>/`, which restores every YAML
including `nutriday.yml`, `ledger-deleted.yml` and `food_catalog.yml`), and move the
temp file back from `_backups/` if it was moved. `scan-repair.json` and
`scan-repair-result.json` in the backup are the reviewed plan and the outcome;
delete them from the nutrition directory after the copy.

`cli/health-icon-manifest-merge.cli.mjs --manifest <path> --food-names <path>` dry-runs the
`foodNames` merge; `--apply --backup <new-path>` writes it. Restart the backend afterwards.
Regenerate the scan report immediately before applying: the live ledger changes constantly.
