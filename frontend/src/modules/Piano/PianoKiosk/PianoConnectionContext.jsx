import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoSound } from './usePianoSound.js';
import { usePianoMix } from './usePianoMix.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { resetPianoBridge } from './pianoBridgeClient.js';
import { derivePianoHealth, pianoHealthCopy, runPianoRepair } from './pianoConnection.js';

export const Ctx = createContext(null);

const repairMessage = (result) => {
  if (result.ok) return 'Piano reconnected — settings restored.';
  if (result.reason === 'already-working') return 'Repair already in progress.';
  if (result.phase === 'bridge-reset') return result.reason === 'timeout' ? 'Piano bridge reset timed out.' : 'Piano bridge could not restore the connection.';
  if (result.phase === 'midi-reacquire') return 'Browser MIDI access could not be restored.';
  if (result.phase === 'health-wait') return result.health === 'input-only' || result.health === 'output-only' ? 'Piano is only partly connected.' : 'Piano did not reconnect in time.';
  return 'Couldn’t repair the piano connection.';
};

/** One connection authority for chrome, banner, startup and Maintenance. */
export function PianoConnectionProvider({ children }) {
  const midi = usePianoMidi();
  const { pianoId } = usePianoKioskConfig();
  const { resync } = usePianoSound();
  const { reassertPianoLevel } = usePianoMix();
  const logger = useMemo(() => getLogger().child({ component: 'piano-connection', pianoId }), [pianoId]);
  const state = derivePianoHealth({ ...midi, bridgeLink: midi.bridgeLink });
  const [repair, setRepair] = useState({ state: 'idle', message: null, result: null });
  const [everReady, setEverReady] = useState(state === 'ready');
  const workingRef = useRef(false);
  const attemptRef = useRef(0);
  const snapshotRef = useRef({ health: state, generation: midi.bindingGeneration || 0 });
  snapshotRef.current = { health: state, generation: midi.bindingGeneration || 0 };

  useEffect(() => { if (state === 'ready') setEverReady(true); }, [state]);
  useEffect(() => {
    if (repair.state !== 'success') return undefined;
    const timer = setTimeout(() => setRepair({ state: 'idle', message: null, result: null }), 2500);
    return () => clearTimeout(timer);
  }, [repair.state]);

  const repairConnection = useCallback(async () => {
    if (workingRef.current) return { ok: false, phase: 'guard', reason: 'already-working', health: snapshotRef.current.health };
    workingRef.current = true;
    const attemptId = ++attemptRef.current;
    const started = Date.now();
    setRepair({ state: 'working', message: 'Repairing connection…', result: null });
    logger.info('piano.connection.repair.started', { attemptId, health: snapshotRef.current.health, bridgeAvailable: !midi.bridgeUnavailable });
    try {
      const result = await runPianoRepair({
        attemptId,
        bridgeAvailable: !midi.bridgeUnavailable,
        resetBridge: () => resetPianoBridge(),
        reacquireMidi: midi.resetLink,
        getSnapshot: () => snapshotRef.current,
        reassertSound: resync,
        reassertLevel: reassertPianoLevel,
      });
      const message = repairMessage(result);
      setRepair({ state: result.ok ? 'success' : 'failed', message, result });
      const logData = { ...result, measuredElapsedMs: Date.now() - started };
      if (result.ok) logger.info('piano.connection.repair.completed', logData);
      else logger.warn('piano.connection.repair.failed', logData);
      return result;
    } finally {
      workingRef.current = false;
    }
  }, [logger, midi.bridgeUnavailable, midi.resetLink, reassertPianoLevel, resync]);

  const health = useMemo(() => ({
    state,
    copy: pianoHealthCopy(state),
    everReady,
    input: { state: midi.midiHealth?.in || 'down', name: midi.inputName || null },
    output: { state: midi.midiHealth?.out || 'down', name: midi.outputName || null },
    bridge: { state: midi.bridgeLink || 'idle', unavailable: !!midi.bridgeUnavailable },
  }), [state, everReady, midi.midiHealth, midi.inputName, midi.outputName, midi.bridgeLink, midi.bridgeUnavailable]);
  const value = useMemo(() => ({ health, repair, repairConnection }), [health, repair, repairConnection]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
