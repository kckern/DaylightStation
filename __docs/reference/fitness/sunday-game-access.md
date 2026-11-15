# Sunday Fitness game access

On Sundays, Fitness games require an admin fingerprint unlock before game code mounts. This applies to Cycle Race, Skyline Glider, Skyline Invaders (Defender), the other registered games-category modules, and the Fitness emulator. Adults, empty learner groups, deep links and localhost use the same rule. Hardware/debug tools are separate modules.

State Gates evaluates `fitness.games-unsupervised` for the household and current `local_day`. Its `fitness.games-outside-sunday` gate permits Monday–Saturday, 00:00–24:00, in the configured household timezone. It denies throughout Sunday, including daylight-saving transitions. The browser uses the canonical decision and validity boundaries; it does not decide weekday in the kiosk timezone.

A successful existing `registerAdmin(moduleId)` response opens only this mounted game, household and local day. It is cleared when leaving/re-entering, changing game/household or crossing the day boundary. A cancelled or late fingerprint cannot open a later game. A game already running on Saturday unmounts at Sunday midnight and requires admin approval before re-entry.

The Sunday gate does not replace a game's School, progress, budget or other existing rules. Scripture can still be required by School. The parent's Sunday approval alone does not mark School complete or publish a household-wide approval.

A missing, ambiguous, indeterminate or expired policy cannot start content. Restore the access check to obtain a canonical household/day before issuing a new admin unlock. A previously received decision remains usable only until its original validity ends. WebSocket messages trigger a canonical recheck; a message alone never grants access.

## Policy rollout

The installed policy includes the gate and entitlement from policy revision 5. When `household[-ID]/state-gates/config.yml` is absent, startup supplies the installed graph and State Gates activates its changed revision.

An authored policy replaces the installed graph, so prepare an additive candidate first:

```sh
node scripts/migrate-fitness-sunday-policy.mjs \
  /path/to/config.yml /path/to/new-candidate.yml /path/to/state-gates/current.json
```

The migration uses the active household validation context, preserves all other definitions, increments the authored revision, rejects conflicting names, and refuses an existing output (including the input). Review and back up the actual configuration, install the candidate through the usual configuration process, then activate/reconcile State Gates. Do not overwrite a custom graph with the installed graph.

Verify `/api/v1/entitlements?capabilityId=fitness.games-unsupervised&subjectKind=household&periodKind=local_day` returns exactly one current household decision. On Saturday its validity ends at Sunday midnight; on Sunday it denies with `OUTSIDE_SCHEDULE`. The response comes from the household selected by the server request context.

Logs: `fitness.game.calendar_verdict`, `fitness.game.calendar_unavailable`, `fitness.game.sunday_unlock_requested`, `fitness.game.sunday_unlock_granted`. Granted entries identify the admin actually returned by the existing identity flow. No fingerprint template or callback secret is logged.
