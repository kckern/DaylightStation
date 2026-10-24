# Garage speaker recovery

The garage speaker sometimes switches itself off while it still has power and
signal. Its smart plug reports **on**, but the plug's power sensor drops to
0 W. Usually the speaker restarts by itself within 5 to 15 s. Sometimes it gets
stuck in a loop of failed restarts, and only cutting its power clears that.
Home Assistant now detects this and power-cycles the plug. Each step is
reported to DaylightStation so the episode shows up in the log store.

## Who owns what

| Piece | Where | Role |
|---|---|---|
| Detection + power cycle | HA `automation.garage_speaker_plug_enforcement` (`_includes/automations/garage_speaker_plug_enforcement.yaml`) | The **only** writer for `switch.garage_speaker_plug`. Its usual job is to keep the plug matched to TV power. The recovery is one more branch inside it. Do not add a second automation that writes to this plug: a burst of commands made the plug drop out on 2026-08-18. |
| Cycle ledger | HA `input_datetime.garage_speaker_cycle_last` / `_prev` | The times of the last two power cycles. They enforce the cap and survive an HA restart. |
| Report relay | HA `rest_command.daylight_station_garage_speaker_event` | POSTs `{ report }` to DaylightStation. Every call site sets `continue_on_error`, so a failed report never stops a recovery. |
| Event endpoint | `POST /api/v1/fitness/garage-speaker/events` (`__app_modules/wellness/fitness/server/api/fitness.mjs`) | Validates the report. Returns 202, or 400 for an unknown event or reason. |
| Vocabulary | `server/domain/services/garageSpeakerHealth.mjs` | A closed set of events with their log levels. Normalizes HA's string numbers, and turns `unavailable` into `null`. |
| Logging + push | `server/application/services/GarageSpeakerHealthService.mjs` | Logs `fitness.garage_speaker.<event>` and attaches the live fitness `sessionId` if there is one. On `gave_up` it pushes the head of household. |
| Push copy | `server/domain/notifications/garageSpeakerPush.mjs` | The `gave_up` text, written to follow the push standard (`__docs/reference/notifications/push-standard.md`). Tag `garage-speaker-recovery`, channel *Household alerts*. |

## The recovery branch

**Triggers** (both have `id: dropout`):
- `sensor.garage_speaker_plug_power` stays below 1 W for 25 s. The 25 s wait
  rides out the speaker's own 5–15 s restarts and the 5–6 s dip it shows every
  time it powers on.
- `switch.garage_speaker_plug` has been on for 60 s. This catches a speaker
  that never powers up at all. `numeric_state` only fires when the value
  crosses the threshold, and 0 W → 0 W is not a crossing.

**Runs only when all of these hold**, checked after the automation's 3 s
settle: the desired state is on, the plug is on, the TV is on
(`input_boolean.garage_tv_power`), the plug has been on for more than 30 s,
and the power is still below 1 W. Otherwise the trigger falls through to the
normal enforcement branches.

**Steps:**
1. Write a logbook entry and report `dropout`.
2. If 2 cycles have already run in the last hour, report `gave_up`
   (`cap_reached`), raise the persistent notification `garage_speaker_recovery`,
   and stop without touching the plug.
3. Otherwise, run power cycles until the cap is reached: record the cycle,
   report `power_cycle`, turn the plug off, wait 10 s, turn it on, then wait up
   to 45 s for more than 3 W. The power must **stay** above 3 W for 10 s more,
   because failed restarts blip up to about 7.5 W and then fall back to 0.
4. If the power is above 3 W, report `recovered` and dismiss the notification.
   If not, report `gave_up` (`no_power_after_cycle`) and raise the
   notification.

**Restart safety.** The automation runs in `mode: restart`. A top-level
condition drops the `tick`, `start` and `dropout` triggers while a recovery is
running (a run is active and a cycle started less than 4 min ago). Without it,
the 5-minute tick could cut a run off between `turn_off` and `turn_on`. A
TV-power or garage-active change still restarts the run, because a new desired
state must win.

## Reading it

```bash
# Every speaker episode, with the fitness session it happened in
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=context.module:garage-speaker AND _time:7d' -d 'limit=200'

# Give-ups only
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="fitness.garage_speaker.gave_up" AND _time:30d'
```

Each event carries these fields: `data.powerW`, `data.currentA`,
`data.durationS` (seconds since the speaker went dark), `data.cycle`,
`data.cyclesLastHour`, `data.reason` (gave_up only), `data.sessionId` and
`data.haContextId`. In HA, every step also writes a logbook row under
"Garage speaker". The raw power history is in the recorder at
`sensor.garage_speaker_plug_power`.

## Not covered

- **Manual recoveries.** When someone presses the plug's own button, nothing
  reports it. Catching that would need a trigger on the plug's on/off state,
  and in `mode: restart` that trigger would fire on the automation's own
  `turn_off` and restart the recovery mid-cycle. The logbook shows these as
  plug state changes with no context.
- **The speaker hardware.** The recovery treats the symptom. Several drop-outs
  per session, some right after current spikes, point at the speaker's power
  brick or its protection circuit.
