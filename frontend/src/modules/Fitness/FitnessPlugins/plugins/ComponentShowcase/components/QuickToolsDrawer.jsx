import React, { useEffect, useMemo, useState, useRef } from 'react';
import useFitnessPlugin from '../../../useFitnessPlugin';
import HeartRateDisplay from '../../../../shared/integrations/HeartRateDisplay/HeartRateDisplay.jsx';
import DeviceAvatar from '../../../../shared/integrations/DeviceAvatar/DeviceAvatar.jsx';
import ElapsedTimer from '../../../../shared/primitives/ElapsedTimer/ElapsedTimer.jsx';

const formatClock = (date, opts) => {
  const hours = opts.twentyFour ? date.getHours() : ((date.getHours() + 11) % 12) + 1;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const suffix = opts.twentyFour ? '' : (date.getHours() >= 12 ? ' PM' : ' AM');
  return `${hours}:${minutes}${opts.showSeconds ? `:${seconds}` : ''}${suffix}`;
};

const useTicker = (ms = 1000) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
};

const QuickToolsDrawer = () => {
  const {
    sessionActive,
    isSessionActive,
    sessionStartTime,
    videoPlayerPaused,
    heartRateDevices = [],
    cadenceDevices = [],
    treasureBox,
    openVoiceMemoCapture,
    voiceMemos = []
  } = useFitnessPlugin('component_showcase');

  const [open, setOpen] = useState(false);
  const [clockOptions, setClockOptions] = useState({ twentyFour: false, showSeconds: false });
  const [stopwatch, setStopwatch] = useState({ running: false, start: null, elapsed: 0, laps: [] });
  const [counter, setCounter] = useState(0);
  const [intervalConfig, setIntervalConfig] = useState({ work: 20, rest: 10, rounds: 8 });
  const [intervalState, setIntervalState] = useState({ mode: 'idle', phase: 'work', remaining: 0, round: 1 });
  const [metronomeBpm, setMetronomeBpm] = useState(90);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const metronomeRef = useRef(null);
  const [tickMarker, setTickMarker] = useState(0);

  useTicker(1000);

  const now = useMemo(() => new Date(), []);
  const clockLabel = formatClock(new Date(), clockOptions);

  const elapsedStopwatch = useMemo(() => {
    if (!stopwatch.running) return stopwatch.elapsed;
    return stopwatch.elapsed + (Date.now() - (stopwatch.start || Date.now()));
  }, [stopwatch]);

  const toggleStopwatch = () => {
    setStopwatch((prev) => {
      if (prev.running) {
        return { ...prev, running: false, elapsed: elapsedStopwatch };
      }
      return { ...prev, running: true, start: Date.now() };
    });
  };

  const resetStopwatch = () => setStopwatch({ running: false, start: null, elapsed: 0, laps: [] });
  const lapStopwatch = () => setStopwatch((prev) => ({ ...prev, laps: [...prev.laps, elapsedStopwatch] }));

  const hrDevice = heartRateDevices[0];
  const cadenceDevice = cadenceDevices[0];

  const stopwatchSeconds = Math.floor(elapsedStopwatch / 1000);
  const stopwatchLabel = new Date(elapsedStopwatch).toISOString().substr(11, 8);

  const memoCount = voiceMemos?.length || 0;

  // Interval timer logic
  useEffect(() => {
    if (intervalState.mode === 'idle' || intervalState.remaining <= 0) return;
    const id = setInterval(() => {
      setIntervalState((prev) => {
        const nextRemaining = prev.remaining - 1;
        if (nextRemaining > 0) return { ...prev, remaining: nextRemaining };

        if (prev.phase === 'work') {
          return { ...prev, phase: 'rest', remaining: intervalConfig.rest };
        }

        // rest finished → next round
        const nextRound = prev.round + 1;
        if (nextRound > intervalConfig.rounds) {
          return { mode: 'idle', phase: 'work', remaining: 0, round: 1 };
        }
        return { ...prev, phase: 'work', remaining: intervalConfig.work, round: nextRound };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [intervalState.mode, intervalState.remaining, intervalState.phase, intervalConfig]);

  const startIntervals = (preset) => {
    setIntervalConfig(preset || intervalConfig);
    setIntervalState({ mode: 'running', phase: 'work', remaining: (preset?.work ?? intervalConfig.work), round: 1 });
  };

  const stopIntervals = () => setIntervalState({ mode: 'idle', phase: 'work', remaining: 0, round: 1 });

  // Metronome tick using setInterval
  useEffect(() => {
    if (!metronomeOn) {
      if (metronomeRef.current) clearInterval(metronomeRef.current);
      metronomeRef.current = null;
      return;
    }
    const intervalMs = Math.max(200, Math.round(60000 / metronomeBpm));
    metronomeRef.current = setInterval(() => {
      setTickMarker((v) => v + 1);
    }, intervalMs);
    return () => {
      if (metronomeRef.current) clearInterval(metronomeRef.current);
    };
  }, [metronomeOn, metronomeBpm]);

  return (
    <>
      {!open && (
        <button className="cs-fab" type="button" onClick={() => setOpen(true)} aria-expanded={false}>
          Tools
        </button>
      )}

      {open && (
        <aside className="cs-tools">
          <div className="cs-tools-header">
            <div>
              <p className="cs-card-kicker">Quick Tools</p>
              <h3 className="cs-card-title">Session Utilities</h3>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`cs-chip ${sessionActive || isSessionActive ? 'chip-live' : 'chip-demo'}`}>
                {sessionActive || isSessionActive ? 'Live' : 'Demo'}
              </span>
              <button type="button" className="cs-tools-close" onClick={() => setOpen(false)} aria-label="Close tools">
                ✕
              </button>
            </div>
          </div>

          <div className="cs-tools-grid">
            <div className="cs-tool">
              <div className="cs-tool-title">Clock</div>
              <div className="cs-tool-value">{clockLabel}</div>
              <div className="cs-tool-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={clockOptions.twentyFour}
                    onChange={(e) => setClockOptions((p) => ({ ...p, twentyFour: e.target.checked }))}
                  />
                  24h
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={clockOptions.showSeconds}
                    onChange={(e) => setClockOptions((p) => ({ ...p, showSeconds: e.target.checked }))}
                  />
                  Seconds
                </label>
              </div>
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Stopwatch</div>
              <div className="cs-tool-value">{stopwatchLabel}</div>
              <div className="cs-tool-actions">
                <button type="button" onClick={toggleStopwatch}>{stopwatch.running ? 'Pause' : 'Start'}</button>
                <button type="button" onClick={lapStopwatch} disabled={!stopwatch.running}>Lap</button>
                <button type="button" onClick={resetStopwatch}>Reset</button>
              </div>
              {stopwatch.laps.length > 0 && (
                <div className="cs-tool-meta">
                  {stopwatch.laps.map((lap, idx) => (
                    <div key={idx}>Lap {idx + 1}: {new Date(lap).toISOString().substr(14, 9)}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Manual Counter</div>
              <div className="cs-tool-value">{counter}</div>
              <div className="cs-tool-actions">
                <button type="button" onClick={() => setCounter((v) => v + 1)}>+1</button>
                <button type="button" onClick={() => setCounter((v) => Math.max(0, v - 1))}>-1</button>
                <button type="button" onClick={() => setCounter(0)}>Reset</button>
              </div>
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Cadence Gauge</div>
              {cadenceDevice ? (
                <DeviceAvatar
                  rpm={cadenceDevice.rpm || cadenceDevice.value || 0}
                  avatarSrc={cadenceDevice.avatarUrl}
                  avatarAlt={cadenceDevice.id || 'Cadence device'}
                  size="md"
                  showValue
                  valueFormat={(v) => `${v || '--'} rpm`}
                />
              ) : (
                <div className="cs-empty">No cadence device</div>
              )}
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Heart Rate</div>
              {hrDevice ? (
                <HeartRateDisplay
                  bpm={hrDevice.value || hrDevice.bpm || hrDevice.hr || 0}
                  zone={hrDevice.zone || 0}
                  size="sm"
                />
              ) : (
                <div className="cs-empty">No HR device</div>
              )}
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Treasure Chest</div>
              <div className="cs-tool-value">{treasureBox?.coins ?? '—'} coins</div>
              <div className="cs-tool-meta">Next reward: {treasureBox?.nextReward ?? '—'}</div>
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Quick Notes</div>
              <div className="cs-tool-value">{memoCount} pending</div>
              <div className="cs-tool-actions">
                <button type="button" onClick={() => openVoiceMemoCapture?.()}>Record</button>
              </div>
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Session Status</div>
              <div className="cs-tool-value">{(sessionActive || isSessionActive) ? 'Active' : 'Idle'}</div>
              <div className="cs-tool-meta">Video {videoPlayerPaused ? 'Paused' : 'Playing'}</div>
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Session Timer</div>
              {sessionStartTime ? (
                <ElapsedTimer startTime={sessionStartTime} paused={!sessionActive && !isSessionActive} format="hh:mm:ss" />
              ) : (
                <div className="cs-empty">No session start</div>
              )}
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Interval Timer</div>
              <div className="cs-tool-value">{intervalState.mode === 'running' ? `${intervalState.phase.toUpperCase()} ${intervalState.remaining}s` : 'Idle'}</div>
              <div className="cs-tool-meta">Round {intervalState.round} / {intervalConfig.rounds}</div>
              <div className="cs-tool-actions">
                <button type="button" onClick={() => startIntervals({ work: 20, rest: 10, rounds: 8 })}>Tabata 20/10</button>
                <button type="button" onClick={() => startIntervals({ work: 40, rest: 20, rounds: 6 })}>HIIT 40/20</button>
                <button type="button" onClick={() => startIntervals()}>Start</button>
                <button type="button" onClick={stopIntervals}>Stop</button>
              </div>
            </div>

            <div className="cs-tool">
              <div className="cs-tool-title">Metronome</div>
              <div className="cs-tool-value">{metronomeBpm} bpm</div>
              <div className="cs-tool-meta">Tick {tickMarker}</div>
              <div className="cs-tool-actions">
                <input
                  type="range"
                  min="60"
                  max="200"
                  value={metronomeBpm}
                  onChange={(e) => setMetronomeBpm(Number(e.target.value))}
                />
                <button type="button" onClick={() => setMetronomeOn((v) => !v)}>
                  {metronomeOn ? 'Stop' : 'Start'}
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </>
  );
};

export default QuickToolsDrawer;
