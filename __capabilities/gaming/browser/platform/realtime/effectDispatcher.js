// Effect dispatcher: maps game events to ordered effects (visuals + audio cues)
// and logs each one. One throwing effect never stops the rest.
export function createEffectDispatcher({
  table,
  playCue,
  log = null,
  logNames = {},
  correlation = () => ({}),
  skippedReason = () => 'audio-unavailable',
}) {
  const info = (name, data) => { if (name && log) log.info(name, data); };
  const fail = (base, err) => {
    if (logNames.failed && log) log.error(logNames.failed, { ...base, error: err.message });
  };

  const dispatch = (events, extra = {}) => {
    for (const event of events) {
      if (logNames.event) info(logNames.event(event), { ...correlation(), ...extra, ...event.data });
      const effects = table[event.type]?.(event, extra) || [];
      for (const effect of effects) {
        const base = { ...correlation(), ...extra, eventType: event.type, effectId: effect.id };
        try {
          if (effect.cue !== undefined) {
            if (playCue(effect.cue)) info(logNames.executed, base);
            else info(logNames.skipped, { ...base, reason: skippedReason() });
          } else {
            effect.visual?.();
            info(logNames.executed, base);
          }
        } catch (err) {
          fail(base, err);
        }
      }
    }
  };

  return { dispatch };
}
