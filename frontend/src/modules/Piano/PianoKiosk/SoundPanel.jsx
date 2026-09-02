import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
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
import { familyArt, voiceArt } from './voiceArt.js';
import { DaylightMediaPath } from '../../../lib/api.mjs';
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

// Illustration URL for a pack basename, or undefined so the tile keeps its icon.
const artUrl = (name) => (name ? DaylightMediaPath(`/static/img/music/instruments/${name}.svg`) : undefined);

function EffectRows({ name, icon, value, config, onChange }) {
  // Off is Off whatever level the bundle still remembers; only the lit steps need an exact level.
  const activeIndex = value.on ? EFFECT_STEPS.findIndex((step) => step.on && step.level === value.level) : 0;
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
  const logger = useMemo(() => getLogger().child({ component: 'piano-sound-sheet' }), []);
  // The rail family is latched when the sheet opens (from the voice playing at
  // that moment) and changes only under the finger. null = not resolved yet,
  // which only lasts until the open effect below runs.
  const [family, setFamily] = useState(null);
  const [favoriteMessage, setFavoriteMessage] = useState(null);
  const [heard, setHeard] = useState(null);
  // A favourite write goes through the same queue as the last-sound write, so
  // its final persistence transition lands in the same commit as the result
  // message. This flag lets that one transition through without clearing the
  // message; it lives for exactly one commit (see the effects below), so a
  // write that never reached the queue (limit, guest) cannot leave it armed.
  const skipNextClearRef = useRef(false);

  const saved = useMemo(() => preset?.favorites || [], [preset?.favorites]);
  const funnel = useMemo(() => buildFunnel({ favorites: saved, shortlistVoices: config?.shortlist?.voices || [], allGroups: device?.voiceGroups || [] }), [saved, config?.shortlist?.voices, device?.voiceGroups]);
  const families = useMemo(() => partitionVoices(funnel.groups), [funnel.groups]);
  const currentKey = soundVoiceKey(currentBundle);
  const currentName = currentBundle?.voice?.name || 'Keyboard';

  const applyEffect = (name, patch) => applyBundle({ ...currentBundle, [name]: { ...currentBundle[name], ...patch } });

  // Mine = favourites (recalled whole) then the deduped house shortlist (voice
  // only). The memo holds data alone — a tile carries its `sound` or `voice`
  // and is bound to applyBundle at render, so a tap always lands on the bundle
  // as it is now, not as it was when the list was built.
  const mineTiles = useMemo(() => [
    ...saved.map((sound, index) => ({ key: `fav:${soundVoiceKey(sound)}:${index}`, voiceKey: soundVoiceKey(sound), name: sound.voice?.name || 'Sound', sound })),
    ...funnel.shortlist.map((voice) => ({ key: `short:${voice.pc}:${voice.bank || 0}`, voiceKey: `${voice.pc}:${voice.bank || 0}`, name: voice.name, voice })),
  ], [saved, funnel.shortlist]);

  const autoFamily = mineTiles.some((tile) => tile.voiceKey === currentKey) ? 'mine' : (familyOf(currentBundle?.voice) || FAMILIES[0].id);
  const autoFamilyRef = useRef(autoFamily);
  autoFamilyRef.current = autoFamily;
  useEffect(() => {
    if (!open) { setFamily(null); return; } // drop the latch while closed so reopen paints the new voice first frame
    setFamily(autoFamilyRef.current);
    setFavoriteMessage(null);
    setHeard(null);
    skipNextClearRef.current = false;
  }, [open]);
  const activeFamily = family ?? autoFamily;
  const gridTiles = activeFamily === 'mine' ? mineTiles
    : (families[activeFamily] || []).map((voice) => ({ key: `${voice.pc}:${voice.bank || 0}`, voiceKey: `${voice.pc}:${voice.bank || 0}`, name: voice.name, voice }));

  const pick = (tile) => {
    const voice = tile.sound ? tile.sound.voice : tile.voice;
    logger.info('piano.sound.pick', { pc: voice?.pc, bank: voice?.bank || 0, name: tile.name, from: activeFamily });
    if (tile.sound) applyBundle(tile.sound);
    else applyBundle({ ...currentBundle, voice: { ...tile.voice, bank: tile.voice.bank || 0 } });
  };

  const savedInstrument = saved.find((sound) => soundVoiceKey(sound) === currentKey);
  const savedExactly = !!savedInstrument && sameSoundPreset(savedInstrument, currentBundle);
  const levelIndex = LEVEL_STEPS.findIndex((step) => step.value === pianoLevel);
  const outputUp = health?.output?.state === 'up';
  // A Hear-it failure is about the link at that moment; once output is back it no longer applies.
  useEffect(() => { if (outputUp) setHeard(null); }, [outputUp]);

  const save = async () => {
    setFavoriteMessage('Saving sound…');
    const result = await saveFavorite(currentBundle);
    skipNextClearRef.current = true;
    setFavoriteMessage(result.ok ? 'Sound saved.' : result.reason === 'limit' ? 'Remove a saved sound before adding another.' : 'Couldn’t save sound.');
  };
  const remove = async () => {
    setFavoriteMessage('Removing sound…');
    const result = await removeFavorite(savedInstrument);
    skipNextClearRef.current = true;
    setFavoriteMessage(result.ok ? 'Saved sound removed.' : 'Couldn’t remove saved sound.');
  };
  const hear = () => {
    const sent = midi.sendNote(60, 100, 0, 500);
    setHeard(sent ? null : 'Piano not connected.');
  };
  const persistenceCopy = persistenceState === 'saving' ? 'Saving…'
    : persistenceState === 'remembered' ? `Remembered for ${playerName}`
      : persistenceState === 'failed' ? 'Couldn’t save' : null;
  // One status slot: the newest message wins. A favourite message holds the
  // slot until persistence moves again, so a change there is never masked —
  // except the transition its own write causes (see skipNextClearRef).
  useEffect(() => {
    if (skipNextClearRef.current) { skipNextClearRef.current = false; return; }
    setFavoriteMessage(null);
  }, [persistenceState]);
  useEffect(() => { skipNextClearRef.current = false; }); // runs after the one above in the same commit
  const statusCopy = favoriteMessage ?? persistenceCopy;
  const showRetry = !favoriteMessage && persistenceState === 'failed';

  return <TransportSheet open={open} title="Sound" onClose={onClose} size="canvas" className="piano-sound-sheet">
    <div className="piano-settings__sound">
      <nav className="piano-settings__rail" role="group" aria-label="Instrument families">
        <TransportButton layout="rail" icon="star" label="Mine" on={activeFamily === 'mine'} aria-pressed={activeFamily === 'mine'} onPress={() => setFamily('mine')} />
        {FAMILIES.map((item) => <TransportButton key={item.id} layout="rail" icon={item.icon} art={artUrl(familyArt(item.id))} label={item.label} on={activeFamily === item.id} aria-pressed={activeFamily === item.id} onPress={() => setFamily(item.id)} />)}
      </nav>

      {/* Rail items and voice tiles are radio-like sets, so each carries an explicit aria-pressed (TransportButton alone omits it when off). */}
      <div className="piano-settings__grid" role="group" aria-label="Instruments">
        {gridTiles.length === 0 && <p className="piano-settings__empty">{activeFamily === 'mine' ? 'Save a sound and it will show up here.' : 'Waiting for the piano’s instrument list…'}</p>}
        {gridTiles.map((tile) => <TransportButton key={tile.key} layout="tile" icon={instrumentIcon(tile.name)} art={artUrl(voiceArt(tile.name))} label={tile.name} on={tile.voiceKey === currentKey} aria-pressed={tile.voiceKey === currentKey} onPress={() => pick(tile)} />)}
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
        {statusCopy && <p role="status" className="piano-settings__note">{statusCopy}{showRetry && <> — <button type="button" className="piano-tbtn piano-tbtn--quiet" onClick={retryLastSound}>Retry</button></>}</p>}
      </div>
    </div>
  </TransportSheet>;
}
