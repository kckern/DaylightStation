# Untracked-intake reconstruction

Backfill days that were never logged, or only partly logged, with one synthetic row each. Each row's calories are a weight-derived
estimate minus what was logged. The goal is that history reads as what was
eaten rather than what was typed in. See
[health README](../reference/health/README.md#untracked-intake-reconstruction)
for how the rows behave in the app.

## 1. Export (read-only copies)

The data volume is root-owned, so the files are copied out through the container:

```bash
X=/path/to/export; mkdir -p $X
L=data/users/<user>/lifelog
for f in withings nutrition/nutriday health fitness; do
  sudo docker exec {env.docker_container} sh -c "cat $L/$f.yml" > $X/$(basename $f).yml; done
mv $X/fitness.yml $X/fitness_current.yml
sudo docker exec {env.docker_container} sh -c "cat data/users/<user>/day_closed.yml" > $X/day_closed.yml
for y in 2025 2026; do
  sudo docker exec {env.docker_container} sh -c "cat $L/archives/fitness/$y.yml" > $X/fitness_$y.yml
  sudo docker exec {env.docker_container} sh -c "cat $L/archives/garmin/$y.yml" > $X/garmin_$y.yml; done
sudo docker exec {env.docker_container} sh -c "cd $L/archives/strava && for f in *.yml; do echo ---; cat \$f; done" > $X/strava_arch.yml
```

## 2. Plan

```bash
node cli/health-reconstruct-untracked.cli.mjs --export $X --from 2025-06-01 --to 2026-07-31 \
  --dexa-date 2025-01-15 --dexa-rmr 1622 --age 41 \
  --corrupt-fitness 2025-12-23:2026-01-24 --out plan.json
```

- **What gets filled:** every day logged under `--min` (default 1200) gets `estimate − logged`. Days at or over the threshold are never touched.
- **The formula and its inputs:** see the CLI header.
- **The month table:** printed to stderr. Review it before applying.
- **`--corrupt-fitness`:** names a window whose `fitness` step and activity data is known bad, so those days are ignored. The known window, 2025-12-23 to 2026-01-24, had 14–24 duplicate "activities" and 40k–114k "steps" a day.
- **Days never filled:** a day closed with `/done`, `/fast` or the day view is final. The planner skips it, and the server refuses it again (`skippedClosed`).
- **Workout steps:** steps taken during workouts are removed before step NEAT, so a walk or run isn't counted twice. Garmin supplies per-activity steps; Strava walks and runs use a per-minute cadence.
- **Missing data stops the run:** a day with no usable weight or lean mass fails loudly instead of dropping out of the plan.
- **Why the multiplier is fixed at 1.1 instead of calibrated from well-logged days:** the well-logged days imply less than the DEXA-measured RMR. That's impossible, so they under-log too, and calibrating on them would bake the under-logging back in.

## 3. Apply (through the app, in-process)

```bash
# dry run: planned / skipped / totalCalories, nothing written
jq '{entries: .entries, dryRun: true}' plan.json | curl -s -X POST -H 'Content-Type: application/json' \
  --data @- http://localhost:{env.ports.app}/api/v1/health/nutrition/reconstruction
# write (operationId makes a retry safe)
jq '{entries: .entries, operationId: "recon-2026-09-24"}' plan.json | curl -s -X POST -H 'Content-Type: application/json' \
  --data @- http://localhost:{env.ports.app}/api/v1/health/nutrition/reconstruction
```

A day that already has a reconstruction row is skipped, so re-applying the plan or a wider one never double-counts.
Snapshot `lifelog/nutrition/` inside the container first. Example: `cp -a` it to a
dated folder under the user's `lifelog/nutrition/_backups/`.

## Undo

```bash
curl -s -X DELETE http://localhost:{env.ports.app}/api/v1/health/nutrition/reconstruction
```

This removes every row carrying the marker, through the ledger. Daily totals return to the logged amounts.
