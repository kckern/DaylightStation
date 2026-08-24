import { useEffect, useMemo, useState } from 'react';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';
import { sameSoundPreset, soundVoiceKey, usePianoPreset } from './usePianoPreset.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoSound } from './PianoSoundContext.jsx';
import { usePianoMix } from './PianoMixContext.jsx';
import { buildFunnel } from './voiceFunnel.js';
import { instrumentEmoji } from './instrumentIcon.js';
import PianoSheet from './PianoSheet.jsx';

const EFFECT_STEPS = Object.freeze([
  { label: 'Off', level: 0, on: false },
  { label: 'Low', level: 32, on: true },
  { label: 'Medium', level: 64, on: true },
  { label: 'High', level: 96, on: true },
  { label: 'Max', level: 127, on: true },
]);
const LEVEL_STEPS = Object.freeze([
  { label: 'Mute', value: 0 }, { label: '25%', value: 0.25 }, { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 }, { label: '100%', value: 1 },
]);

function StepChoices({ label, steps, activeIndex, currentCopy, onPick }) {
  return <div className="piano-sound-panel__tonecard">
    <div className="piano-sound-panel__tonehead"><strong>{label}</strong>{activeIndex < 0 && <small>{currentCopy}</small>}</div>
    <div className="piano-sound-panel__steps" role="group" aria-label={label}>
      {steps.map((step, index) => <button key={step.label} type="button" className={index === activeIndex ? 'is-on' : ''} aria-pressed={index === activeIndex} onClick={() => onPick(step)}>{step.label}</button>)}
    </div>
  </div>;
}

function EffectControl({ label, value, config, onChange }) {
  const activeIndex = EFFECT_STEPS.findIndex((step) => step.level === value.level && step.on === !!value.on);
  const percent = value.on ? Math.round((value.level || 0) / 127 * 100) : 0;
  return <div className="piano-sound-panel__effect">
    <StepChoices label={label} steps={EFFECT_STEPS} activeIndex={activeIndex} currentCopy={`Current: ${percent}%`} onPick={onChange} />
    {config?.types?.length > 0 && <label className="piano-sound-panel__type">{label} type
      <select value={value.type} onChange={(event) => onChange({ type: Number(event.target.value) })}>
        {config.types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
    </label>}
  </div>;
}

export default function SoundPanel({ open, onClose }) {
  const { currentBundle, applyBundle } = usePianoSoundBundle();
  const { preset, saveFavorite, removeFavorite, canSave, persistenceState, retryLastSound, maxFavorites, playerName } = usePianoPreset();
  const { config } = usePianoKioskConfig();
  const { device } = usePianoSound();
  const { pianoLevel, setPianoLevel } = usePianoMix();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [moreEffects, setMoreEffects] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState(null);

  useEffect(() => {
    if (!open) return;
    setBrowseOpen(false);
    setMoreEffects(!!currentBundle?.chorus?.on);
    setFavoriteMessage(null);
  }, [open, currentBundle?.chorus?.on]);

  const saved = useMemo(() => preset?.favorites || [], [preset?.favorites]);
  const funnel = useMemo(() => buildFunnel({ favorites: saved, shortlistVoices: config?.shortlist?.voices || [], allGroups: device?.voiceGroups || [] }), [saved, config?.shortlist?.voices, device?.voiceGroups]);
  const savedInstrument = saved.find((sound) => soundVoiceKey(sound) === soundVoiceKey(currentBundle));
  const savedExactly = !!savedInstrument && sameSoundPreset(savedInstrument, currentBundle);
  const levelIndex = LEVEL_STEPS.findIndex((step) => step.value === pianoLevel);

  const applyVoice = (voice) => applyBundle({ ...currentBundle, voice: { ...voice, bank: voice.bank || 0 } });
  const applyEffect = (name, patch) => applyBundle({ ...currentBundle, [name]: { ...currentBundle[name], ...patch } });
  const save = async () => {
    setFavoriteMessage('Saving sound…');
    const result = await saveFavorite(currentBundle);
    setFavoriteMessage(result.ok ? 'Sound saved.' : result.reason === 'limit' ? 'Remove a saved sound before adding another.' : 'Couldn’t save sound.');
  };
  const remove = async () => {
    setFavoriteMessage('Removing sound…');
    const result = await removeFavorite(savedInstrument);
    setFavoriteMessage(result.ok ? 'Saved sound removed.' : 'Couldn’t remove saved sound.');
  };
  const persistenceCopy = persistenceState === 'saving' ? 'Saving…'
    : persistenceState === 'remembered' ? `Remembered for ${playerName}`
      : persistenceState === 'failed' ? 'Couldn’t save — Retry' : null;

  return <PianoSheet open={open} title="Sound" onClose={onClose} className="piano-sound-panel">
    <section>
      <h3>Current sound</h3>
      <div className="piano-sound-panel__current"><span aria-hidden>{instrumentEmoji(currentBundle?.voice?.name)}</span><strong>{currentBundle?.voice?.name || 'Keyboard'}</strong></div>
      {persistenceCopy && <p role="status">{persistenceCopy}</p>}
      {persistenceState === 'failed' && <button type="button" onClick={retryLastSound}>Retry</button>}
      {canSave ? <div className="piano-sound-panel__save-actions">
        <button type="button" onClick={save} disabled={savedExactly || (!savedInstrument && saved.length >= maxFavorites)}>{savedExactly ? 'Saved' : savedInstrument ? 'Update saved sound' : 'Save sound'}</button>
        {savedInstrument && <button type="button" onClick={remove}>Remove</button>}
      </div> : <p>Pick a player to save sounds.</p>}
      {favoriteMessage && <p role="status">{favoriteMessage}</p>}
    </section>

    {saved.length > 0 && <section><h3>Saved sounds</h3><div className="piano-sound-panel__tiles">
      {saved.map((sound, index) => <button key={`${soundVoiceKey(sound)}:${index}`} type="button" className="piano-sound-panel__tile" onClick={() => applyBundle(sound)}><span aria-hidden>{instrumentEmoji(sound.voice?.name)}</span>{sound.voice?.name || 'Sound'}</button>)}
    </div></section>}

    {funnel.shortlist.length > 0 && <section><h3>Recommended</h3><div className="piano-sound-panel__tiles">
      {funnel.shortlist.map((voice) => <button key={`${voice.pc}:${voice.bank || 0}`} type="button" className="piano-sound-panel__tile" onClick={() => applyVoice(voice)}><span aria-hidden>{instrumentEmoji(voice.name)}</span>{voice.name}</button>)}
    </div></section>}

    {funnel.groups.length > 0 && <section>
      <button type="button" className="piano-sound-panel__browse-toggle" aria-expanded={browseOpen} onClick={() => setBrowseOpen((value) => !value)}>{browseOpen ? 'Done browsing' : 'Browse instruments'}</button>
      {browseOpen && <div className="piano-sound-panel__browse">{funnel.groups.map((group) => <details key={group.group} className="piano-sound-panel__family"><summary>{group.group}</summary><div className="piano-sound-panel__voices">{group.voices.map((voice) => <button key={voice.no ?? `${voice.pc}:${voice.bank || 0}`} type="button" className={soundVoiceKey({ voice }) === soundVoiceKey(currentBundle) ? 'piano-sound-panel__voice is-active' : 'piano-sound-panel__voice'} onClick={() => applyVoice(voice)}>{voice.name}</button>)}</div></details>)}</div>}
    </section>}

    {currentBundle?.reverb && <section><h3>Effects</h3>
      <EffectControl label="Room sound" value={currentBundle.reverb} config={device?.effects?.reverb} onChange={(patch) => applyEffect('reverb', patch)} />
      <button type="button" aria-expanded={moreEffects} onClick={() => setMoreEffects((value) => !value)}>{moreEffects ? 'Less effects' : 'More effects'}</button>
      {moreEffects && currentBundle?.chorus && <EffectControl label="Chorus" value={currentBundle.chorus} config={device?.effects?.chorus} onChange={(patch) => applyEffect('chorus', patch)} />}
    </section>}

    <section><h3>Piano level</h3>
      <StepChoices label="Piano level" steps={LEVEL_STEPS} activeIndex={levelIndex} currentCopy={`Current: ${Math.round(pianoLevel * 100)}%`} onPick={(step) => setPianoLevel(step.value)} />
      <p>This piano remembers this level.</p>
    </section>
  </PianoSheet>;
}
