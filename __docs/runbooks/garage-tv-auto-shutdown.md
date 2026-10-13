# Garage TV automatic shutdown

The garage Fitness kiosk reports two live activities to `POST /api/v1/fitness/garage-human-activity`: the Emulation module being open and a Fitness session with an active HR participant. Once an HR participant has appeared, protection remains through temporary strap dropouts until that Fitness session ends. Only the kiosk identified as `garage-tv` publishes this state.

The backend mirrors their logical OR to Home Assistant's `input_boolean.garage_human_activity`. The kiosk republishes every minute and whenever either activity changes. The HA helper starts **on** after an HA restart; automatic shutdown stays blocked until the kiosk reports its current state. A kiosk crash can leave the helper on, which keeps the TV safe but delays vacancy shutdown until the kiosk reconnects.

The Home Assistant config lives in `homeassistant/_includes` on the homeserver. `garage_lights_turn_off_when_empty`, `garage_switch_lights_off_deactive_garage`, and `garage_tv_idle_deactivate` check that the helper is off before calling `script.garage_deactivate`. Those calls pass `automatic: true`, and the script checks the helper again before starting and before powering off the TV. `garage_activate` also marks its failure rollback automatic. Explicit physical shutdown controls and Fitness emergency lockdown still call deactivation without that flag.

To inspect a reported shutoff, compare HA history for `input_boolean.garage_human_activity`, `script.garage_deactivate`, `script.garage_tv_off`, `input_boolean.garage_active_intent`, and `binary_sensor.garage_tv_state`. The DaylightStation log event `fitness.garage_human_activity.synced` shows what the backend last sent to HA; `fitness.garage_human_activity.publish_failed` shows kiosk delivery errors.

When releasing a temporary vacancy-automation pause, first confirm the helper exists and is `on` during Emulation or an active HR session, then turn `automation.garage_lights_turn_off_when_empty` back on. Its YAML `initial_state: true` also restores it on HA restart.
