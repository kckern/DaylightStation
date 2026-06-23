import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { NoteWaterfall } from '../../../components/NoteWaterfall';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';
import { createSimState, stepSim, TEST_DEFAULTS } from './pianoTestStream.js';

/**
 * Paint test harness — a self-driving mode that simulates dense piano playing so
 * the kiosk's animated render path (NoteWaterfall + PianoKeyboard) can be
 * reproduced and profiled WITHOUT a human at the keyboard. Invoke via URL:
 *
 *   /piano/test/<scene>/<nps>/<poly>/<dur>   e.g. /piano/test/full/16/8/0
 *
 *   scene : waterfall | keyboard | full (default)
 *   nps   : note-ons per second (drives concurrent animated-note count)
 *   poly  : max simultaneous held notes
 *   dur   : seconds then auto-stop (0 = run until navigated away)
 *   query overrides: ?hold=<ms>&lo=<midi>&hi=<midi>&seed=<n>
 *
 * Stepped at a fixed 30Hz independent of frame rate, so the input load stays
 * constant even while the GPU janks — the whole point is to measure that jank.
 */
export default function PianoTest() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-test' }), []);
  const { '*': splat = '' } = useParams();
  const [sp] = useSearchParams();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const { setPlaying } = usePianoPlayback();

  const params = useMemo(() => {
    const seg = splat.split('/').filter(Boolean);
    const numAt = (i, key, def) => {
      const raw = (i != null ? seg[i] : undefined) ?? sp.get(key);
      const n = Number(raw);
      return raw != null && raw !== '' && Number.isFinite(n) ? n : def;
    };
    return {
      scene: seg[0] || sp.get('scene') || TEST_DEFAULTS.scene,
      nps: numAt(1, 'nps', TEST_DEFAULTS.nps),
      poly: numAt(2, 'poly', TEST_DEFAULTS.poly),
      dur: numAt(3, 'dur', TEST_DEFAULTS.dur),
      holdMs: numAt(null, 'hold', TEST_DEFAULTS.holdMs),
      lo: numAt(null, 'lo', TEST_DEFAULTS.lo),
      hi: numAt(null, 'hi', TEST_DEFAULTS.hi),
      seed: numAt(null, 'seed', TEST_DEFAULTS.seed),
    };
  }, [splat, sp]);

  const [render, setRender] = useState({ history: [], active: new Map() });
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const stateRef = useRef(null);
  const startRef = useRef(0);

  // Keep the kiosk shell from returning to the menu / screensaver while testing.
  useEffect(() => { setPlaying(true); return () => setPlaying(false); }, [setPlaying]);

  useEffect(() => {
    stateRef.current = createSimState(params);
    startRef.current = Date.now();
    setRunning(true);
    logger.info('piano.test.start', params);
    const id = setInterval(() => {
      const now = Date.now();
      const el = now - startRef.current;
      if (params.dur > 0 && el >= params.dur * 1000) {
        clearInterval(id);
        setRunning(false);
        logger.info('piano.test.stop', { ...params, notes: stateRef.current.history.length });
        return;
      }
      const st = stepSim(stateRef.current, now, params);
      setRender({ history: st.history, active: new Map(st.active) });
      setElapsed(el);
    }, 33);
    return () => clearInterval(id);
  }, [params, logger]);

  const showWaterfall = params.scene === 'waterfall' || params.scene === 'full';
  const showKeys = params.scene === 'keyboard' || params.scene === 'full';

  return (
    <div className="piano-test" data-testid="piano-test">
      <div className="piano-test-hud" data-testid="piano-test-hud">
        <div><b>PIANO PAINT TEST</b> — {running ? 'RUNNING' : 'DONE'}</div>
        <div>scene={params.scene} nps={params.nps} poly={params.poly} hold={params.holdMs}ms</div>
        <div>active={render.active.size} notes={render.history.length} t={(elapsed / 1000).toFixed(1)}s</div>
      </div>

      {showWaterfall && (
        <div className="piano-test__waterfall">
          <NoteWaterfall
            noteHistory={render.history}
            activeNotes={render.active}
            startNote={kb.startNote}
            endNote={kb.endNote}
          />
        </div>
      )}

      {showKeys && (
        <div className="piano-test__keys">
          <PianoKeyboard activeNotes={render.active} startNote={kb.startNote} endNote={kb.endNote} />
        </div>
      )}
    </div>
  );
}
