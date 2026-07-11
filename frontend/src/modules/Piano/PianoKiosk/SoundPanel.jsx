import { useMemo, useState } from 'react';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';
import { usePianoPreset } from './usePianoPreset.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoSound } from './PianoSoundContext.jsx';
import { buildFunnel } from './voiceFunnel.js';
import { instrumentEmoji } from './instrumentIcon.js';
import Icon from './icons/Icon.jsx';

const MAX_FAVORITES_SHOWN = 5;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Tone is set in five discrete steps, not a slider — easier to hit on a touch
// kiosk and every choice is a named, repeatable amount. "Off" genuinely
// disables the effect (on:false, level 0); Low…Max ramp the send and force on.
const FX_STEPS = [
  { label: 'Off', level: 0, on: false },
  { label: 'Low', level: 32, on: true },
  { label: 'Med', level: 64, on: true },
  { label: 'High', level: 96, on: true },
  { label: 'Max', level: 127, on: true },
];
const VOL_STEPS = [
  { label: 'Off', value: 0 },
  { label: 'Low', value: 0.25 },
  { label: 'Med', value: 0.5 },
  { label: 'High', value: 0.75 },
  { label: 'Max', value: 1 },
];
// Which step is lit for a given current value — the nearest one by amount.
const nearestStep = (steps, key, val) => {
  let best = 0;
  let bestDist = Infinity;
  steps.forEach((s, i) => {
    const d = Math.abs(s[key] - val);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
};

/**
 * One tone control: an icon + name (+ optional type select) header over a
 * five-button Off/Low/Med/High/Max stepper. Full-bleed so every row's edges
 * line up. `activeIndex` lights the current step; `onPick` gets (step, index).
 */
function ToneStepper({ icon, name, steps, activeIndex, onPick, typeSelect }) {
  return (
    <div className="piano-sound-panel__tonecard">
      <div className="piano-sound-panel__tonehead">
        <Icon name={icon} className="piano-sound-panel__toneicon" />
        <span className="piano-sound-panel__tonename">{name}</span>
        {typeSelect}
      </div>
      <div className="piano-sound-panel__steps" role="group" aria-label={name}>
        {steps.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`piano-sound-panel__step${i === activeIndex ? ' is-on' : ''}${i === 0 ? ' is-off' : ''}`}
            aria-pressed={i === activeIndex}
            onClick={() => onPick(s, i)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Player Sound Panel — the ONLY sound surface a family member sees (tap the
 * chrome sound chip). Three regions: the voice funnel (favorites → house
 * shortlist → browse-all, on demand), Tone (reverb/chorus/volume), and Save
 * (default / favorite). Every change re-asserts the FULL bundle through
 * applyBundle — never a lone CC — per the "full-state MIDI burst" design.
 *
 * Deliberately contains NOTHING destructive or operator-facing (no MIDI
 * monitor, no Panic/Local/PC test, no reload, no Bluetooth/Connect, no
 * screen-off). Those live in the Operator Drawer, reached by long-pressing
 * the same chip — a different surface entirely.
 */
export default function SoundPanel({ open, onClose }) {
  const { currentBundle, applyBundle } = usePianoSoundBundle();
  const { preset, saveDefault, addFavorite } = usePianoPreset();
  const { config } = usePianoKioskConfig();
  const { device } = usePianoSound();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [family, setFamily] = useState(null);

  const funnel = useMemo(() => buildFunnel({
    favorites: preset?.favorites || [],
    shortlistVoices: config?.shortlist?.voices || [],
    allGroups: device?.voiceGroups || [],
  }), [preset, config, device]);

  const favorites = funnel.favorites.slice(0, MAX_FAVORITES_SHOWN);
  const groups = funnel.groups;

  // Default the browse-all family selector to whichever group holds the
  // currently-active voice (mirrors PianoKeyboardPanel's activeGroup idiom).
  const defaultFamily = useMemo(() => groups.find((g) => g.voices.some(
    (v) => v.pc === currentBundle?.voice?.pc && (v.bank || 0) === (currentBundle?.voice?.bank || 0),
  ))?.group || groups[0]?.group, [groups, currentBundle]);
  const activeFamily = family || defaultFamily;
  const shownGroup = groups.find((g) => g.group === activeFamily) || groups[0];

  if (!open) return null;

  const applyVoice = (v) => {
    applyBundle({ ...currentBundle, voice: { pc: v.pc, bank: v.bank || 0, name: v.name } });
  };
  const updateReverb = (patch) => {
    applyBundle({ ...currentBundle, reverb: { ...currentBundle.reverb, ...patch } });
  };
  const updateChorus = (patch) => {
    applyBundle({ ...currentBundle, chorus: { ...currentBundle.chorus, ...patch } });
  };
  const updateVolume = (v) => {
    applyBundle({ ...currentBundle, volume: clamp01(v) });
  };

  const reverbCfg = device?.effects?.reverb;
  const chorusCfg = device?.effects?.chorus;

  return (
    <div className="piano-sound-panel" role="dialog" aria-label="Sound" aria-modal="true">
      <div className="piano-sound-panel__scrim" onClick={onClose} />
      <aside className="piano-sound-panel__sheet">
        <header className="piano-sound-panel__head">
          <h2>Sound</h2>
          <button type="button" className="piano-sound-panel__close" onClick={onClose} aria-label="Close sound panel">
            <Icon name="close" />
          </button>
        </header>

        {/* ── Funnel: favorites → house shortlist → browse-all (on demand) ── */}
        {favorites.length > 0 && (
          <section className="piano-sound-panel__section">
            <h3 className="piano-sound-panel__eyebrow">Your Favorites</h3>
            <ul className="piano-sound-panel__tiles">
              {favorites.map((fav, i) => (
                <li key={`${fav.voice?.pc ?? 'x'}:${fav.voice?.bank ?? 0}:${i}`}>
                  <button type="button" className="piano-sound-panel__tile" onClick={() => applyBundle(fav)}>
                    <span className="piano-sound-panel__tileicon" aria-hidden="true">{instrumentEmoji(fav.voice?.name)}</span>
                    <span className="piano-sound-panel__tilename">{fav.voice?.name || 'Sound'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {funnel.shortlist.length > 0 && (
          <section className="piano-sound-panel__section">
            <h3 className="piano-sound-panel__eyebrow">House Shortlist</h3>
            <ul className="piano-sound-panel__tiles">
              {funnel.shortlist.map((v) => (
                <li key={`${v.pc}:${v.bank}`}>
                  <button type="button" className="piano-sound-panel__tile" onClick={() => applyVoice(v)}>
                    <span className="piano-sound-panel__tileicon" aria-hidden="true">{instrumentEmoji(v.name)}</span>
                    <span className="piano-sound-panel__tilename">{v.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length > 0 && (
          <section className="piano-sound-panel__section">
            <button
              type="button"
              className="piano-sound-panel__browse-toggle"
              aria-expanded={browseOpen}
              onClick={() => setBrowseOpen((o) => !o)}
            >
              {browseOpen ? 'Hide all voices' : 'Browse all voices'}
            </button>
            {browseOpen && (
              <div className="piano-sound-panel__browse">
                <select
                  className="piano-sound-panel__family"
                  value={activeFamily}
                  onChange={(e) => setFamily(e.target.value)}
                  aria-label="Voice family"
                >
                  {groups.map((g) => <option key={g.group} value={g.group}>{instrumentEmoji(g.group)} {g.group}</option>)}
                </select>
                <ul className="piano-sound-panel__voices">
                  {shownGroup?.voices.map((v) => (
                    <li key={v.no ?? `${v.pc}:${v.bank}`}>
                      <button
                        type="button"
                        className={`piano-sound-panel__voice${v.pc === currentBundle?.voice?.pc && (v.bank || 0) === (currentBundle?.voice?.bank || 0) ? ' is-active' : ''}`}
                        onClick={() => applyVoice(v)}
                      >
                        {v.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ── Tone: reverb / chorus / volume — every change re-asserts the full bundle ── */}
        <section className="piano-sound-panel__section">
          <h3 className="piano-sound-panel__eyebrow">Tone</h3>
          <div className="piano-sound-panel__tone">
            {reverbCfg && currentBundle?.reverb && (
              <ToneStepper
                icon="reverb"
                name={reverbCfg.label}
                steps={FX_STEPS}
                activeIndex={currentBundle.reverb.on ? nearestStep(FX_STEPS, 'level', currentBundle.reverb.level) : 0}
                onPick={(s) => updateReverb({ level: s.level, on: s.on })}
                typeSelect={(
                  <span className="piano-sound-panel__tonetype">
                    <select
                      value={currentBundle.reverb.type}
                      onChange={(e) => updateReverb({ type: Number(e.target.value) })}
                      aria-label={`${reverbCfg.label} type`}
                    >
                      {reverbCfg.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </span>
                )}
              />
            )}
            {chorusCfg && currentBundle?.chorus && (
              <ToneStepper
                icon="chorus"
                name={chorusCfg.label}
                steps={FX_STEPS}
                activeIndex={currentBundle.chorus.on ? nearestStep(FX_STEPS, 'level', currentBundle.chorus.level) : 0}
                onPick={(s) => updateChorus({ level: s.level, on: s.on })}
                typeSelect={(
                  <span className="piano-sound-panel__tonetype">
                    <select
                      value={currentBundle.chorus.type}
                      onChange={(e) => updateChorus({ type: Number(e.target.value) })}
                      aria-label={`${chorusCfg.label} type`}
                    >
                      {chorusCfg.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </span>
                )}
              />
            )}
            <ToneStepper
              icon="volume"
              name="Volume"
              steps={VOL_STEPS}
              activeIndex={nearestStep(VOL_STEPS, 'value', currentBundle?.volume ?? 1)}
              onPick={(s) => updateVolume(s.value)}
            />
          </div>
        </section>

        {/* ── Save: snapshot the current bundle onto the active user ── */}
        <footer className="piano-sound-panel__foot">
          <button type="button" className="piano-sound-panel__save" onClick={() => saveDefault(currentBundle)}>
            Save as my default
          </button>
          <button type="button" className="piano-sound-panel__favorite" onClick={() => addFavorite(currentBundle)}>
            Add to favorites
          </button>
        </footer>
      </aside>
    </div>
  );
}
