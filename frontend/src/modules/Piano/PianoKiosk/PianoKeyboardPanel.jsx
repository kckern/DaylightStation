import { useMemo, useState } from 'react';
import { usePianoSound } from './PianoSoundContext.jsx';

/**
 * Keyboard panel (Settings → Keyboard) — drives the onboard hardware over MIDI:
 * pick one of the device's grouped voices (Program Change / Bank Select) and tune
 * Reverb / Chorus (CC). Only rendered when config names a `device`.
 */
export default function PianoKeyboardPanel() {
  const { device, deviceVoice, selectVoice, effects, setEffect } = usePianoSound();
  const groups = device?.voiceGroups || [];

  // Which family is shown — defaults to the group holding the active voice.
  const activeGroup = useMemo(
    () => groups.find((g) => g.voices.some((v) => v.no === deviceVoice?.no))?.group || groups[0]?.group,
    [groups, deviceVoice],
  );
  const [family, setFamily] = useState(activeGroup);
  const shown = groups.find((g) => g.group === family) || groups[0];

  if (!device) return null;

  return (
    <div className="piano-kbd">
      <div className="piano-kbd__voicebar">
        <select className="piano-kbd__family" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Voice family">
          {groups.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
        </select>
        <span className="piano-kbd__active">{deviceVoice ? `${String(deviceVoice.no).padStart(3, '0')} ${deviceVoice.name}` : ''}</span>
      </div>

      <ul className="piano-kbd__voices">
        {shown?.voices.map((v) => (
          <li key={v.no}>
            <button
              type="button"
              className={`piano-kbd__voice${v.no === deviceVoice?.no ? ' is-active' : ''}`}
              aria-pressed={v.no === deviceVoice?.no}
              onClick={() => selectVoice(v)}
            >
              {v.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="piano-kbd__fx">
        {['reverb', 'chorus'].map((name) => {
          const fx = device.effects[name];
          const st = effects?.[name];
          if (!fx || !st) return null;
          return (
            <div key={name} className="piano-kbd__fxrow">
              <button
                type="button"
                className={`piano-kbd__fxtoggle${st.on ? ' is-on' : ''}`}
                aria-pressed={st.on}
                onClick={() => setEffect(name, { on: !st.on })}
              >
                {fx.label}
              </button>
              <select
                className="piano-kbd__fxtype"
                value={st.type}
                onChange={(e) => setEffect(name, { type: Number(e.target.value) })}
                aria-label={`${fx.label} type`}
                disabled={!st.on}
              >
                {fx.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                type="range" min={0} max={127} step={1} value={st.level}
                onChange={(e) => setEffect(name, { level: Number(e.target.value) })}
                aria-label={`${fx.label} depth`} disabled={!st.on}
              />
              <span className="piano-kbd__fxval">{Math.round((st.level / 127) * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
