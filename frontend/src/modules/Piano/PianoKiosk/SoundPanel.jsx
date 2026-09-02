import { useEffect, useMemo, useState } from 'react';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';
import { sameSoundPreset, soundVoiceKey, usePianoPreset } from './usePianoPreset.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoSound } from './usePianoSound.js';
import { usePianoMix } from './usePianoMix.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoConnection } from './usePianoConnection.js';
import { buildFunnel } from './voiceFunnel.js';
import { FAMILIES, familyOf, partitionVoices } from './voiceFamilies.js';
import { instrumentIcon } from './instrumentIcon.js';
import TransportSheet from './transport/TransportSheet.jsx';
import TransportButton from './transport/TransportButton.jsx';
import StepGrid from './transport/StepGrid.jsx';
import SettingsTile from './SettingsTile.jsx';
import Icon from '../ui/icons/Icon.jsx';
import './SettingsSheets.scss';

// Five canonical steps per effect. A bundle whose level matches none of them
// (a legacy preset, a value set elsewhere) lights nothing and the head shows the
// real number — the picker never claims a nearest step it did not set.
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
// Device type names shortened to fit a five-across tile row.
const TYPE_LABELS = Object.freeze({ 'Large Room': 'Big room', 'Large Hall': 'Big hall', 'Chorus 1': 'One', 'Chorus 2': 'Two', 'Chorus 3': 'Three', 'FB Chorus': 'Deep', Flanger: 'Flange' });

function EffectRows({ name, icon, value, config, onChange }) {
  const activeIndex = EFFECT_STEPS.findIndex((step) => step.level === value.level && step.on === !!value.on);
  const percent = value.on ? Math.round((value.level || 0) / 127 * 100) : 0;
  const types = config?.types || [];
  const typeIndex = types.findIndex((type) => type.value === value.type);
  return <>
    <div className="piano-settings__tonehead"><Icon name={icon} /><span>{name}</span>{activeIndex < 0 && <small>now {percent}%</small>}</div>
    <StepGrid ariaLabel={name} steps={EFFECT_STEPS.map((step) => ({ label: step.label }))} activeIndex={activeIndex} onPick={(i) => onChange({ level: EFFECT_STEPS[i].level, on: EFFECT_STEPS[i].on })} />
    {types.length > 0 && <StepGrid ariaLabel={`${name} type`} steps={types.map((type) => ({ label: TYPE_LABELS[type.label] || type.label }))} activeIndex={typeIndex} onPick={(i) => onChange({ type: types[i].value })} />}
  </>;
}

export default function SoundPanel({ open, onClose }) {
  const { currentBundle, applyBundle } = usePianoSoundBundle();
  const { preset, saveFavorite, removeFavorite, canSave, persistenceState, retryLastSound, maxFavorites, playerName } = usePianoPreset();
  const { config } = usePianoKioskConfig();
  const { device } = usePianoSound();
  const { pianoLevel, setPianoLevel } = usePianoMix();
  const midi = usePianoMidi();
  const { health } = usePianoConnection();
  const [family, setFamily] = useState(null); // null = follow the current voice
  const [favoriteMessage, setFavoriteMessage] = useState(null);
  const [heard, setHeard] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFamily(null);
    setFavoriteMessage(null);
    setHeard(null);
  }, [open]);

  const saved = useMemo(() => preset?.favorites || [], [preset?.favorites]);
  const funnel = useMemo(() => buildFunnel({ favorites: saved, shortlistVoices: config?.shortlist?.voices || [], allGroups: device?.voiceGroups || [] }), [saved, config?.shortlist?.voices, device?.voiceGroups]);
  const families = useMemo(() => partitionVoices(funnel.groups), [funnel.groups]);
  const currentKey = soundVoiceKey(currentBundle);
  const currentName = currentBundle?.voice?.name || 'Keyboard';

  const applyVoice = (voice) => applyBundle({ ...currentBundle, voice: { ...voice, bank: voice.bank || 0 } });
  const applyEffect = (name, patch) => applyBundle({ ...currentBundle, [name]: { ...currentBundle[name], ...patch } });

  // Mine = favourites (recalled whole) then the deduped house shortlist (voice only).
  const mineTiles = useMemo(() => [
    ...saved.map((sound, index) => ({ key: `fav:${soundVoiceKey(sound)}:${index}`, voiceKey: soundVoiceKey(sound), name: sound.voice?.name || 'Sound', pick: () => applyBundle(sound) })),
    ...funnel.shortlist.map((voice) => ({ key: `short:${voice.pc}:${voice.bank || 0}`, voiceKey: `${voice.pc}:${voice.bank || 0}`, name: voice.name, pick: () => applyVoice(voice) })),
  ], [saved, funnel.shortlist]); // eslint-disable-line react-hooks/exhaustive-deps -- applyBundle/applyVoice are stable per render of the bundle they close over

  const autoFamily = mineTiles.some((tile) => tile.voiceKey === currentKey) ? 'mine' : (familyOf(currentBundle?.voice) || FAMILIES[0].id);
  const activeFamily = family ?? autoFamily;
  const gridTiles = activeFamily === 'mine' ? mineTiles
    : (families[activeFamily] || []).map((voice) => ({ key: `${voice.pc}:${voice.bank || 0}`, voiceKey: `${voice.pc}:${voice.bank || 0}`, name: voice.name, pick: () => applyVoice(voice) }));

  const savedInstrument = saved.find((sound) => soundVoiceKey(sound) === currentKey);
  const savedExactly = !!savedInstrument && sameSoundPreset(savedInstrument, currentBundle);
  const levelIndex = LEVEL_STEPS.findIndex((step) => step.value === pianoLevel);
  const outputUp = health?.output?.state === 'up';

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
  const hear = () => {
    const sent = midi.sendNote(60, 100, 0, 500);
    setHeard(sent ? null : 'Piano not connected.');
  };
  const persistenceCopy = persistenceState === 'saving' ? 'Saving…'
    : persistenceState === 'remembered' ? `Remembered for ${playerName}`
      : persistenceState === 'failed' ? 'Couldn’t save' : null;

  return <TransportSheet open={open} title="Sound" onClose={onClose} size="canvas" className="piano-sound-sheet">
    <div className="piano-settings__sound">
      <nav className="piano-settings__rail" role="group" aria-label="Instrument families">
        <TransportButton layout="rail" icon="star" label="Mine" on={activeFamily === 'mine'} onPress={() => setFamily('mine')} />
        {FAMILIES.map((item) => <TransportButton key={item.id} layout="rail" icon={item.icon} label={item.label} on={activeFamily === item.id} onPress={() => setFamily(item.id)} />)}
      </nav>

      {/* Voice tiles are one radio-like set, so every tile carries an explicit aria-pressed (TransportButton alone omits it when off). */}
      <div className="piano-settings__grid" role="group" aria-label="Instruments">
        {gridTiles.length === 0 && <p className="piano-settings__empty">Save a sound and it will show up here.</p>}
        {gridTiles.map((tile) => <TransportButton key={tile.key} layout="tile" icon={instrumentIcon(tile.name)} label={tile.name} on={tile.voiceKey === currentKey} aria-pressed={tile.voiceKey === currentKey} onPress={tile.pick} />)}
      </div>

      <div className="piano-settings__tonecol">
        <div className="piano-settings__current"><Icon name={instrumentIcon(currentName)} /><strong>{currentName}</strong></div>
        {currentBundle?.reverb && <EffectRows name="Reverb" icon="reverb" value={currentBundle.reverb} config={device?.effects?.reverb} onChange={(patch) => applyEffect('reverb', patch)} />}
        {currentBundle?.chorus && <EffectRows name="Chorus" icon="chorus" value={currentBundle.chorus} config={device?.effects?.chorus} onChange={(patch) => applyEffect('chorus', patch)} />}
        <div className="piano-settings__tonehead"><Icon name="volume" /><span>Piano level</span>{levelIndex < 0 && <small>now {Math.round(pianoLevel * 100)}%</small>}</div>
        <StepGrid ariaLabel="Piano level" steps={LEVEL_STEPS.map((step) => ({ label: step.label }))} activeIndex={levelIndex} onPick={(i) => setPianoLevel(LEVEL_STEPS[i].value)} />
        <p className="piano-settings__note">This piano remembers this level.</p>
        <SettingsTile icon="music" label="Hear it" emphasis="primary" disabled={!outputUp} onPress={hear} message={!outputUp ? 'Piano not connected.' : heard} tone={!outputUp || heard ? 'failed' : 'idle'} />
        {canSave ? <div className="piano-settings__save">
          <TransportButton label={savedExactly ? 'Saved' : savedInstrument ? 'Update saved sound' : 'Save sound'} icon="star" disabled={savedExactly || (!savedInstrument && saved.length >= maxFavorites)} onPress={save} />
          {savedInstrument && <TransportButton label="Remove" icon="trash" emphasis="quiet" onPress={remove} />}
        </div> : <p className="piano-settings__note">Pick a player to save sounds.</p>}
        {favoriteMessage && <p role="status" className="piano-settings__note">{favoriteMessage}</p>}
        {persistenceCopy && <p role="status" className="piano-settings__note">{persistenceCopy}{persistenceState === 'failed' && <> — <button type="button" className="piano-tbtn piano-tbtn--quiet" onClick={retryLastSound}>Retry</button></>}</p>}
      </div>
    </div>
  </TransportSheet>;
}
