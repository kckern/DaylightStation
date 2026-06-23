import { useEffect, useMemo, useRef } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import useProducer from './useProducer.js';
import { drumForNote, DEFAULT_SPLIT } from './producerKeys.js';

/**
 * Producer — DJ-style loop & pad launcher. A platter/deck for the beat bed, a pad
 * bank (loop toggles + one-shots), and a split keyboard: white keys below the
 * split fire the kit's one-shots, the rest play melodic over the mix. Kits come
 * from media/audio/dj (see useProducer).
 */
export function Producer() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer' }), []);
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const splitNote = config?.producer?.splitNote ?? DEFAULT_SPLIT;
  const { activeNotes, pressNote, releaseNote, subscribe } = usePianoMidi();
  const { kits, kitId, setKitId, kit, ready, loopOn, error, playOneShot, toggleLoop, stopAll, playing } = useProducer();

  useEffect(() => { logger.info('piano.producer.mounted', {}); return () => logger.info('piano.producer.unmounted', {}); }, [logger]);
  useKeepScreenAwake('producer', playing);

  const oneshots = kit?.oneshots || [];
  const loops = kit?.loops || [];

  // Hardware MIDI: drum-zone keys fire one-shots (kept in a ref so the listener is stable).
  const oneshotsRef = useRef(oneshots);
  oneshotsRef.current = oneshots;
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((e) => {
      if (e.type !== 'note_on') return;
      const id = drumForNote(e.note, splitNote, oneshotsRef.current);
      if (id) playOneShot(id);
    });
  }, [subscribe, splitNote, playOneShot]);

  // On-screen keyboard: drum-zone keys fire one-shots; melodic keys play normally.
  const onNoteOn = (note, vel) => {
    const id = drumForNote(note, splitNote, oneshots);
    if (id) playOneShot(id);
    else pressNote(note, vel);
  };
  const onNoteOff = (note) => { if (!drumForNote(note, splitNote, oneshots)) releaseNote(note); };

  return (
    <section className="piano-mode piano-producer-mode">
      {kits === null && <PianoEmpty loading />}
      {kits && kits.length === 0 && <PianoEmpty message="No kits yet — drop one into media/audio/dj (loops + one-shots + kit.yml)." />}

      {kit && (
        <div className="piano-producer-mode__body">
          <header className="piano-producer-mode__deck">
            <div className={`piano-producer-mode__platter${playing ? ' is-spinning' : ''}`} aria-hidden>
              <span className="piano-producer-mode__spindle" />
            </div>
            <div className="piano-producer-mode__deckinfo">
              {kits.length > 1 ? (
                <select className="piano-producer-mode__kit" value={kitId} onChange={(e) => setKitId(e.target.value)} aria-label="Kit">
                  {kits.map((k) => <option key={k.id} value={k.id}>{k.id}</option>)}
                </select>
              ) : (
                <div className="piano-producer-mode__kitname">{kit.name}</div>
              )}
              <div className="piano-producer-mode__bpm">{kit.bpm} BPM{kit.key ? ` · ${kit.key}` : ''}</div>
              <button type="button" className="piano-producer-mode__stop" onClick={stopAll} disabled={!playing}>Stop</button>
            </div>
          </header>

          <div className="piano-producer-mode__pads">
            {loops.length > 0 && (
              <div className="piano-producer-mode__padrow">
                <span className="piano-producer-mode__padlabel">Loops</span>
                {loops.map((l) => (
                  <button
                    key={l.id} type="button"
                    className={`piano-pad piano-pad--loop${loopOn.has(l.id) ? ' is-on' : ''}`}
                    onClick={() => toggleLoop(l.id)} disabled={!ready}
                  >{l.name}</button>
                ))}
              </div>
            )}
            {oneshots.length > 0 && (
              <div className="piano-producer-mode__padrow">
                <span className="piano-producer-mode__padlabel">One-shots</span>
                {oneshots.map((o) => (
                  <button
                    key={o.id} type="button" className="piano-pad piano-pad--shot"
                    onPointerDown={() => playOneShot(o.id)} disabled={!ready}
                  >{o.name}</button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="piano-mode__placeholder">{error}</p>}
        </div>
      )}

      {/* Full-width split keyboard footer. */}
      <div className="piano-producer-mode__keys">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={kb.startNote}
          endNote={kb.endNote}
          splitNote={splitNote}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
        />
      </div>
    </section>
  );
}

export default Producer;
