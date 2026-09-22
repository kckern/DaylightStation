import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoKioskConfig, usePianoRosterOptional } from './PianoConfig.jsx';
import { usePianoMidiNotes } from './PianoMidiContext.jsx';
import { useMetronomeClick } from './modes/SheetMusic/useMetronomeClick.js';
import { resolveClickLead } from './modes/SheetMusic/clickLead.js';
import { audioContext } from './modes/SheetMusic/click.js';
import { CALIBRATION, calibrationClickTimes, summarizeCalibration } from './clickCalibrationMath.js';
import { writePianoConfigValue } from './pianoConfigWrite.js';
import SettingsTile from './SettingsTile.jsx';

const PERIOD_MS = 60000 / CALIBRATION.bpm;
const LEAD_KEY = ['timing', 'clickLeadMs'];

const REASON_COPY = {
  'too-few': `Too few presses lined up with a click — need ${CALIBRATION.minMatched} of ${CALIBRATION.clicks}.`,
  'too-uneven': `The presses were too uneven to trust (spread over ${CALIBRATION.maxSpreadMs} ms).`,
};

const epochNow = () => Date.now();

const SOURCE_COPY = { config: 'measured', browser: 'browser estimate', none: 'not measured' };

/**
 * ClickCalibration — grown-up tap-along that measures how late the metronome
 * click reaches the ear (plus MIDI input lag) and saves it as
 * `timing.clickLeadMs` for this piano. Hosted in Piano maintenance.
 *
 * Plays CALIBRATION.clicks anchored clicks with leadMs 0; each key press is
 * stamped with its note timestamp from the live-note store, matched to the
 * nearest click, and summarised as median offset + IQR spread
 * (clickCalibrationMath.js). Save is offered only when the spread is tight enough.
 */
export default function ClickCalibration({ onBack, now = epochNow }) {
  const { config, pianoId } = usePianoKioskConfig();
  const roster = usePianoRosterOptional();
  const { activeNotes } = usePianoMidiNotes();
  const logger = useMemo(() => getLogger().child({ component: 'piano-click-calibration', pianoId }), [pianoId]);

  const [phase, setPhase] = useState('idle'); // idle | running | result
  const [anchorMs, setAnchorMs] = useState(null);
  const [clock, setClock] = useState(0);
  const [summary, setSummary] = useState(null);
  const [save, setSave] = useState({ state: 'idle', message: null });
  const pressesRef = useRef([]);
  const seenRef = useRef(new Map());
  const [pressCount, setPressCount] = useState(0);

  const current = resolveClickLead(config, audioContext());

  useEffect(() => {
    logger.debug('piano.click.calibration.open', { currentLeadMs: current.leadMs, source: current.source });
    return () => logger.debug('piano.click.calibration.close', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, [logger]);

  useMetronomeClick({
    enabled: phase === 'running',
    bpm: CALIBRATION.bpm,
    anchorMs: anchorMs ?? undefined,
    leadMs: 0,
    beatsPerBar: 4,
  });

  const start = useCallback(() => {
    const anchor = now() + CALIBRATION.startDelayMs;
    pressesRef.current = [];
    // Keys already down when Start is pressed are not presses.
    seenRef.current = new Map([...(activeNotes || new Map())].map(([note, v]) => [note, v?.timestamp]));
    setPressCount(0);
    setSummary(null);
    setSave({ state: 'idle', message: null });
    setAnchorMs(anchor);
    setClock(now());
    setPhase('running');
    logger.info('piano.click.calibration.start', {
      bpm: CALIBRATION.bpm, clicks: CALIBRATION.clicks, anchorMs: anchor,
      outputLatencyMs: current.outputLatencyMs, baseLatencyMs: current.baseLatencyMs,
    });
  }, [activeNotes, current.baseLatencyMs, current.outputLatencyMs, logger, now]);

  // Collect note-ons while running: a note whose timestamp we have not seen is a press.
  useEffect(() => {
    if (phase !== 'running' || !activeNotes) return;
    let added = 0;
    for (const [note, v] of activeNotes) {
      const ts = v?.timestamp;
      if (!Number.isFinite(ts) || seenRef.current.get(note) === ts) continue;
      seenRef.current.set(note, ts);
      pressesRef.current.push(ts);
      added += 1;
    }
    if (added) setPressCount(pressesRef.current.length);
  }, [activeNotes, phase]);

  // Progress clock + finish half a period after the last click.
  useEffect(() => {
    if (phase !== 'running' || anchorMs == null) return undefined;
    const endMs = anchorMs + (CALIBRATION.clicks - 1) * PERIOD_MS + PERIOD_MS / 2;
    const id = setInterval(() => {
      const t = now();
      setClock(t);
      if (t < endMs) return;
      const clicks = calibrationClickTimes(anchorMs);
      const result = summarizeCalibration(clicks, pressesRef.current);
      setSummary(result);
      setPhase('result');
      logger.info('piano.click.calibration.result', { anchorMs, ...result });
    }, 200);
    return () => clearInterval(id);
  }, [anchorMs, logger, now, phase]);

  const saveLead = useCallback(async () => {
    if (!summary?.canSave) return;
    setSave({ state: 'working', message: 'Saving…' });
    try {
      const { path } = await writePianoConfigValue({ pianoId, keyPath: LEAD_KEY, value: summary.leadMs });
      roster?.reload?.();
      setSave({ state: 'success', message: `Saved ${summary.leadMs} ms.` });
      logger.info('piano.click.calibration.save', { leadMs: summary.leadMs, path, previousLeadMs: current.leadMs, previousSource: current.source });
    } catch (error) {
      setSave({ state: 'failed', message: `Couldn’t save: ${error?.message || 'request failed'}` });
      logger.warn('piano.click.calibration.save-failed', { leadMs: summary.leadMs, error: error?.message });
    }
  }, [current.leadMs, current.source, logger, pianoId, roster, summary]);

  const beat = anchorMs == null ? 0 : Math.max(0, Math.min(CALIBRATION.clicks, Math.floor((clock - anchorMs) / PERIOD_MS) + 1));

  return <div className="piano-settings__calib">
    <SettingsTile icon="back" label="Back" onPress={onBack} />
    <div className="piano-settings__calibbody" role="group" aria-label="Click timing">
      <strong>Click timing</strong>
      <p className="piano-settings__note">
        Play any key on every click you hear — {CALIBRATION.clicks} clicks, one a second. Play what you hear, not what you expect.
      </p>
      <p data-testid="calib-current">
        Now: {current.leadMs} ms early ({SOURCE_COPY[current.source]})
      </p>

      {phase === 'running' && <p role="status" data-testid="calib-progress">
        {beat === 0 ? 'Get ready…' : `Click ${beat} of ${CALIBRATION.clicks}`} · {pressCount} presses heard
      </p>}

      {phase === 'result' && summary && <div role="status" data-testid="calib-result" className="piano-settings__calibresult">
        <span>Matched {summary.matched} of {CALIBRATION.clicks} clicks ({summary.presses} presses)</span>
        <span>Median delay: {summary.medianMs == null ? '—' : `${summary.medianMs} ms`}</span>
        <span>Spread (IQR): {summary.spreadMs == null ? '—' : `${summary.spreadMs} ms`}</span>
        {!summary.canSave && <span className="is-failed">{REASON_COPY[summary.reason]}</span>}
      </div>}

      <div className="piano-settings__calibactions">
        <SettingsTile
          icon="metronome"
          label={phase === 'idle' ? 'Start' : phase === 'running' ? 'Listening…' : 'Try again'}
          emphasis={phase === 'result' && summary?.canSave ? 'default' : 'primary'}
          disabled={phase === 'running'}
          onPress={start}
        />
        {phase === 'result' && summary?.canSave && <SettingsTile
          icon="star"
          label={`Save ${summary.leadMs} ms`}
          emphasis="primary"
          disabled={save.state === 'working' || save.state === 'success'}
          onPress={saveLead}
          message={save.message}
          tone={save.state}
        />}
      </div>
    </div>
  </div>;
}
