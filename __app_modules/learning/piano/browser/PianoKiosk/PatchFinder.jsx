import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { usePianoKioskConfig, usePianoRosterOptional } from './PianoConfig.jsx';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoSound } from './usePianoSound.js';
import { useBridgeMidiTap } from './useBridgeMidiTap.js';
import { writePianoConfigValue } from './pianoConfigWrite.js';
import {
  ADDRESS_FIELDS, addressFor, catalogAddress, catalogKey, formatAddress, patchEntry, sameAddress, setAddressField, stepAddress,
} from './devices/voicePatches.js';
import './PatchFinder.scss';

// The audition phrase: a rising arpeggio then the chord, long enough to judge
// attack, body and decay of a piano patch. Middle C up.
const PHRASE = [
  { at: 0, notes: [60] }, { at: 220, notes: [64] }, { at: 440, notes: [67] }, { at: 660, notes: [72] },
  { at: 1000, notes: [48, 60, 64, 67, 72], dur: 1400 },
];
const FIELD_LABEL = { msb: 'Bank MSB', lsb: 'Bank LSB', pc: 'Program' };
const FIELD_HINT = { msb: 'CC 0', lsb: 'CC 32', pc: 'sent as-is' };
// The working address carries the three wire values only (addressFor adds `patched`).
const bare = (a) => (a ? { msb: a.msb, lsb: a.lsb, pc: a.pc } : null);

function AddressDial({ field, value, onStep, onSet }) {
  const [draft, setDraft] = useState(null);
  const commit = () => { if (draft != null) onSet(field, draft); setDraft(null); };
  return (
    <div className="pf-dial" role="group" aria-label={FIELD_LABEL[field]}>
      <span className="pf-dial__label">{FIELD_LABEL[field]}</span>
      <button type="button" className="pf-dial__step" aria-label={`${FIELD_LABEL[field]} up`} onClick={() => onStep(field, 1)}>▲</button>
      <input
        className="pf-dial__value"
        aria-label={`${FIELD_LABEL[field]} value`}
        inputMode="numeric"
        value={draft ?? String(value)}
        onFocus={(e) => { setDraft(String(value)); e.target.select(); }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
      />
      <button type="button" className="pf-dial__step" aria-label={`${FIELD_LABEL[field]} down`} onClick={() => onStep(field, -1)}>▼</button>
      <span className="pf-dial__hint">{FIELD_HINT[field]}</span>
    </div>
  );
}

/**
 * Patch finder — find the MIDI address that really plays each catalog voice on
 * THIS keyboard, by ear, and save it. Loop: pick a voice → play → nudge the
 * address → play → … → Save. Or press the voice button on the keyboard itself
 * and adopt whatever it sent (right column, via the bridge's raw MIDI tap).
 *
 * Auditions never change the selected voice; leaving restores it (resync).
 */
export default function PatchFinder({ onBack }) {
  const { pianoId } = usePianoKioskConfig();
  const roster = usePianoRosterOptional();
  const midi = usePianoMidi();
  const { device, deviceVoice, voicePatches, auditionAddress, resync } = usePianoSound();
  const logger = useMemo(() => getLogger().child({ component: 'piano-patch-finder', pianoId }), [pianoId]);
  const tap = useBridgeMidiTap({ enabled: true });

  const groups = device?.voiceGroups || [];
  const [voice, setVoice] = useState(() => deviceVoice || groups[0]?.voices?.[0] || null);
  const [address, setAddress] = useState(() => bare(addressFor(voice, voicePatches)));
  const [autoPlay, setAutoPlay] = useState(true);
  const [save, setSave] = useState({ state: 'idle', message: null });
  const timers = useRef([]);

  const saved = addressFor(voice, voicePatches);
  const catalog = catalogAddress(voice);
  const dirty = !sameAddress(address, saved);

  const stopPhrase = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  const play = useCallback(() => {
    stopPhrase();
    for (const step of PHRASE) {
      timers.current.push(setTimeout(() => step.notes.forEach((n) => midi.sendNote(n, 90, 0, step.dur || 260)), step.at));
    }
  }, [midi, stopPhrase]);

  const audition = useCallback((next, { reason, playAfter = autoPlay, forVoice = voice } = {}) => {
    setAddress(next);
    setSave({ state: 'idle', message: null });
    auditionAddress(next);
    logger.info('piano.patch-finder.try', { reason, voice: catalogKey(forVoice), msb: next.msb, lsb: next.lsb, pc: next.pc });
    if (playAfter) timers.current.push(setTimeout(play, 150));
  }, [auditionAddress, autoPlay, logger, play, voice]);

  useEffect(() => {
    logger.info('piano.patch-finder.mounted', { voice: catalogKey(voice), patched: Object.keys(voicePatches || {}).length });
    return () => {
      timers.current.forEach(clearTimeout);
      resync(); // put the real selected voice back on the piano
      logger.info('piano.patch-finder.unmounted', {});
    };
    // Mount/unmount only: resync must restore whatever is selected at exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickVoice = (v) => {
    setVoice(v);
    const next = bare(addressFor(v, voicePatches));
    audition(next, { reason: 'pick-voice', forVoice: v });
  };

  const onStep = (field, delta) => audition(stepAddress(address, field, delta), { reason: `step-${field}` });
  const onSet = (field, value) => {
    const next = setAddressField(address, field, value);
    if (next !== address) audition(next, { reason: `type-${field}` });
  };

  const saveAddress = useCallback(async () => {
    if (!voice) return;
    const key = catalogKey(voice);
    const isCatalog = sameAddress(address, catalog);
    setSave({ state: 'working', message: 'Saving…' });
    try {
      const { path } = await writePianoConfigValue({
        pianoId, keyPath: ['voicePatches', key], value: isCatalog ? undefined : patchEntry(address, voice),
      });
      roster?.reload?.();
      setSave({ state: 'success', message: isCatalog ? `${voice.name} uses the catalog address again.` : `Saved: ${voice.name} = ${formatAddress(address)}.` });
      logger.info('piano.patch-finder.save', { voice: key, name: voice.name, path, cleared: isCatalog, msb: address.msb, lsb: address.lsb, pc: address.pc, previous: saved });
    } catch (error) {
      setSave({ state: 'failed', message: `Couldn’t save: ${error?.message || 'request failed'}` });
      logger.warn('piano.patch-finder.save-failed', { voice: key, error: error?.message });
    }
  }, [address, catalog, logger, pianoId, roster, saved, voice]);

  if (!device) {
    return <div className="pf"><button type="button" className="pf-back" onClick={onBack}>‹ Back</button>
      <p className="pf-empty">This piano has no device profile (<code>device:</code> in piano config), so there is nothing to map.</p></div>;
  }

  return (
    <div className="pf">
      <header className="pf-head">
        <button type="button" className="pf-back" onClick={onBack}>‹ Back</button>
        <div>
          <strong>Patch finder</strong>
          <span>Play, nudge the address, play again. Save when it sounds right.</span>
        </div>
      </header>

      <nav className="pf-voices" aria-label="Voices">
        {groups.map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            {g.voices.map((v) => {
              const key = catalogKey(v);
              return (
                <button
                  type="button" key={key}
                  className={`pf-voice${catalogKey(voice) === key ? ' is-on' : ''}`}
                  aria-pressed={catalogKey(voice) === key}
                  onClick={() => pickVoice(v)}
                >
                  <span className="pf-voice__no">{v.no}</span>
                  <span className="pf-voice__name">{v.name}</span>
                  {voicePatches?.[key] && <span className="pf-voice__badge" title="Saved patch">saved</span>}
                </button>
              );
            })}
          </section>
        ))}
      </nav>

      <main className="pf-bench">
        <div className="pf-target">
          <span className="pf-target__name">{voice?.name}</span>
          <span className="pf-target__ref">
            Catalog {formatAddress(catalog)}
            {saved?.patched && <> · Saved {formatAddress(saved)}</>}
          </span>
        </div>

        <div className="pf-dials">
          {ADDRESS_FIELDS.map((f) => <AddressDial key={f} field={f} value={address[f]} onStep={onStep} onSet={onSet} />)}
        </div>

        <div className="pf-loop">
          <button type="button" className="pf-loop__btn" onClick={() => onStep('pc', -1)}>‹ Prev</button>
          <button type="button" className="pf-loop__btn pf-loop__play" onClick={play}>▶ Play</button>
          <button type="button" className="pf-loop__btn" onClick={() => onStep('pc', 1)}>Next ›</button>
        </div>
        <label className="pf-auto">
          <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} /> Play after each change
        </label>

        <div className="pf-save">
          <button type="button" className="pf-save__btn" disabled={!dirty || save.state === 'working'} onClick={saveAddress}>
            {saved?.patched && sameAddress(address, catalog) ? `Use catalog for ${voice?.name}` : `Save as ${voice?.name}`}
          </button>
          {saved?.patched && !sameAddress(address, catalog) && (
            <button type="button" className="pf-save__reset" onClick={() => audition(catalog, { reason: 'back-to-catalog' })}>Back to catalog address</button>
          )}
          <p role="status" className={`pf-save__msg is-${save.message ? save.state : 'idle'}`}>
            {save.message || (dirty ? `Not saved yet. ${voice?.name} still plays ${formatAddress(saved)}.` : `This is the address ${voice?.name} uses now.`)}
          </p>
        </div>
      </main>

      <aside className="pf-heard" aria-label="Sent by the keyboard">
        <h4>From the keyboard</h4>
        <p className="pf-heard__hint">
          {tap.state === 'unavailable' ? 'Only on the piano tablet (needs the bridge).'
            : tap.state === 'error' ? 'Can’t read the bridge right now.'
              : 'Press a voice button on the piano. Whatever it sends shows up here.'}
        </p>
        <ul className="pf-heard__list">
          {tap.changes.map((c) => (
            <li key={`${c.at}-${c.ch}-${c.pc}`}>
              <span><b>{formatAddress(c)}</b> <small>ch {c.ch}</small></span>
              <button type="button" onClick={() => { logger.info('piano.patch-finder.adopt', { ch: c.ch, msb: c.msb, lsb: c.lsb, pc: c.pc }); audition({ msb: c.msb, lsb: c.lsb, pc: c.pc }, { reason: 'from-keyboard' }); }}>Try</button>
            </li>
          ))}
        </ul>
        {tap.state === 'listening' && tap.changes.length === 0 && <p className="pf-heard__idle">Listening…</p>}
      </aside>
    </div>
  );
}
