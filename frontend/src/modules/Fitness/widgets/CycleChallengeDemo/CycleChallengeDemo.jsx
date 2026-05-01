import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import './CycleChallengeDemo.scss';

/**
 * CycleChallengeDemo
 *
 * Self-running production demo for the cycle-challenge feature. Mounts on
 * top of FitnessPlayer when the URL has ?cycle-demo=1 and immediately
 * walks the cycle SM through every state without user input:
 *
 *   1. activate HR auto-session for the first 2 configured devices
 *   2. trigger a forced cycle challenge (bypasses base-req gates)
 *   3. drive RPM through init -> ramp -> maintain -> locked -> recover
 *      -> phases-complete with sustained RPMs (re-sent each second so
 *      cadence freshness doesn't decay)
 *   4. on completion, repeat from step 2 — the demo runs in a loop until
 *      the user closes it
 *
 * Telemetry refreshes every 500ms. The current stage is highlighted in
 * the panel so a viewer can correlate the visual overlay with the
 * scripted RPM input.
 */

function safeReadGov() {
  if (typeof window === 'undefined') return null;
  const g = window.__fitnessGovernance;
  if (!g) return null;
  return {
    phase: g.phase,
    activeChallenge: g.activeChallenge,
    activeChallengeType: g.activeChallengeType,
    activeChallengeEquipment: g.activeChallengeEquipment,
    cycleState: g.cycleState,
    currentRpm: g.currentRpm,
    riderId: g.riderId,
    currentPhaseIndex: g.currentPhaseIndex,
    totalPhases: g.totalPhases,
    phaseProgressPct: g.phaseProgressPct
  };
}

function safeReadSession() {
  if (typeof window === 'undefined') return null;
  const stats = window.__fitnessSession?.getMemoryStats?.();
  if (!stats) return null;
  return {
    sessionActive: stats.sessionActive,
    rosterSize: stats.rosterSize,
    deviceCount: stats.deviceCount
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function CycleChallengeDemo({ onClose }) {
  const logger = useMemo(() => getLogger().child({ component: 'cycle-challenge-demo' }), []);
  const [tick, setTick] = useState(0);
  const [stage, setStage] = useState('Initializing demo…');
  const [running, setRunning] = useState(true);
  const [iteration, setIteration] = useState(0);
  const sustainRef = useRef(null);
  const cancelRef = useRef(false);

  // 500ms tick for telemetry.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1000000), 500);
    return () => clearInterval(id);
  }, []);

  const ctl = typeof window !== 'undefined' ? window.__fitnessSimController : null;
  const equipment = useMemo(() => ctl?.getEquipment?.() || [], [ctl, tick]);
  const cycleAce = equipment.find((e) => e.equipmentId === 'cycle_ace') || null;
  const selection = useMemo(() => {
    const list = ctl?.listCycleSelections?.() || [];
    return list.find((s) => s.equipment === 'cycle_ace') || null;
  }, [ctl, tick]);

  const gov = safeReadGov();
  const session = safeReadSession();

  const setSustainedRpm = useCallback((rpm) => {
    if (sustainRef.current) {
      clearInterval(sustainRef.current);
      sustainRef.current = null;
    }
    if (!ctl) return;
    ctl.setRpm('cycle_ace', rpm);
    if (rpm > 0) {
      sustainRef.current = setInterval(() => ctl.setRpm('cycle_ace', rpm), 1000);
    }
  }, [ctl]);

  const clearChallenge = useCallback(() => {
    if (typeof window === 'undefined') return;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    if (engine?.challengeState) {
      engine.challengeState.activeChallenge = null;
      engine._updateGlobalState?.();
    }
  }, []);

  // Self-running script.
  useEffect(() => {
    if (!running || !ctl) return undefined;
    cancelRef.current = false;

    const stageLog = (text) => {
      if (cancelRef.current) return;
      logger.info('stage', { text });
      setStage(text);
    };

    const sleepCancellable = async (ms) => {
      const start = Date.now();
      while (!cancelRef.current && Date.now() - start < ms) {
        await sleep(Math.min(200, ms - (Date.now() - start)));
      }
    };

    const run = async () => {
      while (!cancelRef.current && running) {
        try {
          // 1. Start HR — drive devices into hot zone immediately so any
          //    surrounding base-req gate is satisfied. setHR is direct;
          //    we don't depend on the auto-session waveform timing.
          stageLog('1/8 Starting HR for 2 riders @ 145 BPM');
          const devices = ctl.getDevices?.() || [];
          const hrTargets = devices.slice(0, 2);
          if (hrTargets.length === 0) {
            stageLog('No HR devices configured — cannot run demo.');
            return;
          }
          // Hold HR steady at 145 every second so the engine sees them as live participants.
          const hrInterval = setInterval(() => {
            if (cancelRef.current) return;
            hrTargets.forEach((d) => ctl.setHR(d.deviceId, 145));
          }, 1000);
          hrTargets.forEach((d) => ctl.setHR(d.deviceId, 145));
          await sleepCancellable(3000);
          if (cancelRef.current) { clearInterval(hrInterval); return; }

          // 2. Trigger — forced so it bypasses governance gates.
          if (!cycleAce || !selection) {
            stageLog('cycle_ace or selection not in catalog — cannot trigger.');
            clearInterval(hrInterval);
            return;
          }
          const riderId = cycleAce.eligibleUsers[0];
          stageLog(`2/8 Triggering cycle (rider=${riderId})`);
          const trig = ctl.triggerCycleChallenge({ selectionId: selection.id, riderId });
          if (!trig?.success) {
            stageLog(`Trigger failed: ${trig?.reason || 'unknown'}`);
            clearInterval(hrInterval);
            await sleepCancellable(5000);
            continue;
          }

          // 3. INIT → 0 RPM hold (slate-blue ring).
          stageLog('3/8 INIT — RPM 0 (slate-blue ring) for 5s');
          setSustainedRpm(0);
          await sleepCancellable(5000);
          if (cancelRef.current) { clearInterval(hrInterval); return; }

          // 4. RAMP → 35 RPM (above min_rpm, below hi).
          stageLog('4/8 RAMP — RPM 35 (warm-yellow ring) for 8s');
          setSustainedRpm(35);
          await sleepCancellable(8000);
          if (cancelRef.current) { clearInterval(hrInterval); return; }

          // 5. MAINTAIN → 90 RPM (above hi for any phase).
          stageLog('5/8 MAINTAIN — RPM 90 (green ring, progress fills) for 12s');
          setSustainedRpm(90);
          await sleepCancellable(12000);
          if (cancelRef.current) { clearInterval(hrInterval); return; }

          // 6. LOCKED → 0 RPM (below lo).
          stageLog('6/8 LOCKED — RPM 0 (red ring, video dim) for 8s');
          setSustainedRpm(0);
          await sleepCancellable(8000);
          if (cancelRef.current) { clearInterval(hrInterval); return; }

          // 7. RECOVER → 90 RPM.
          stageLog('7/8 RECOVER — RPM 90 (back to ramp/maintain) for 8s');
          setSustainedRpm(90);
          await sleepCancellable(8000);
          if (cancelRef.current) { clearInterval(hrInterval); return; }

          // 8. PHASES → sustain 100 RPM until the cycle clears (success).
          stageLog('8/8 PHASES — RPM 100 sustained, advancing to success…');
          setSustainedRpm(100);
          const phaseDeadline = Date.now() + 180000;
          while (!cancelRef.current && Date.now() < phaseDeadline) {
            const g = safeReadGov();
            if (!g || g.activeChallengeType !== 'cycle') break;
            stageLog(`8/8 PHASES — phase ${(g.currentPhaseIndex ?? 0) + 1}/${g.totalPhases} state=${g.cycleState} rpm=${g.currentRpm} progress=${Math.round((g.phaseProgressPct ?? 0) * 100)}%`);
            await sleepCancellable(1500);
          }

          clearInterval(hrInterval);
          setSustainedRpm(0);
          stageLog(`Iteration ${iteration + 1} complete. Restarting in 5s…`);
          setIteration((i) => i + 1);
          await sleepCancellable(5000);
          if (cancelRef.current) return;
          // Clear any residual challenge before re-triggering so the next
          // iteration starts cleanly.
          clearChallenge();
          await sleepCancellable(500);
        } catch (err) {
          logger.error('demo_loop_error', { error: err?.message });
          stageLog(`Error: ${err?.message || err}`);
          await sleepCancellable(5000);
        }
      }
    };

    run();
    return () => {
      cancelRef.current = true;
      if (sustainRef.current) clearInterval(sustainRef.current);
    };
  }, [running, ctl, cycleAce?.equipmentId, selection?.id, setSustainedRpm, clearChallenge, logger, iteration]);

  const handleStop = () => {
    setRunning(false);
    cancelRef.current = true;
    if (sustainRef.current) {
      clearInterval(sustainRef.current);
      sustainRef.current = null;
    }
    if (ctl) ctl.setRpm('cycle_ace', 0);
    setStage('Stopped.');
  };

  const handleStart = () => {
    setRunning(true);
    setIteration((i) => i + 1);
  };

  const lockReason = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    return engine?.challengeState?.activeChallenge?.lockReason || null;
  }, [tick]);

  const cadence = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    return engine?._latestInputs?.equipmentCadenceMap?.cycle_ace || null;
  }, [tick]);

  const rowStyle = (active) => ({
    background: active ? 'rgba(34,197,94,0.18)' : 'transparent',
    color: active ? '#86efac' : '#cbd5e1'
  });

  return (
    <div className="cycle-challenge-demo">
      <div className="cycle-challenge-demo__header">
        <span className="cycle-challenge-demo__title">Cycle Challenge Demo</span>
        {onClose ? (
          <button type="button" className="cycle-challenge-demo__close" onClick={onClose} aria-label="Close">✕</button>
        ) : null}
      </div>

      <div className="cycle-challenge-demo__section">
        <div className="cycle-challenge-demo__section-title">Stage</div>
        <div className="cycle-challenge-demo__stage">{stage}</div>
        <div className="cycle-challenge-demo__btn-row">
          {running ? (
            <button onClick={handleStop}>⏸ Stop demo</button>
          ) : (
            <button onClick={handleStart}>▶ Restart demo</button>
          )}
        </div>
      </div>

      <div className="cycle-challenge-demo__section">
        <div className="cycle-challenge-demo__section-title">Telemetry</div>
        <table className="cycle-challenge-demo__table">
          <tbody>
            <tr><td>governance.phase</td><td>{gov?.phase || '—'}</td></tr>
            <tr><td>session.active</td><td>{String(session?.sessionActive ?? '—')}</td></tr>
            <tr><td>roster / devices</td><td>{session ? `${session.rosterSize} / ${session.deviceCount}` : '—'}</td></tr>
            <tr style={rowStyle(gov?.activeChallengeType === 'cycle')}>
              <td>activeChallengeType</td><td>{gov?.activeChallengeType || '—'}</td>
            </tr>
            <tr><td>rider</td><td>{gov?.riderId || '—'}</td></tr>
            <tr style={rowStyle(gov?.cycleState === 'maintain')}>
              <td>cycleState</td><td><strong>{gov?.cycleState || '—'}</strong></td>
            </tr>
            <tr><td>lockReason</td><td>{lockReason || '—'}</td></tr>
            <tr><td>currentRpm</td><td>{gov?.currentRpm ?? '—'}</td></tr>
            <tr><td>cadenceMap.rpm</td><td>{cadence?.rpm ?? '—'} ({cadence?.connected ? 'connected' : 'stale'})</td></tr>
            <tr>
              <td>phase</td>
              <td>{gov?.currentPhaseIndex != null ? `${gov.currentPhaseIndex + 1} / ${gov.totalPhases}` : '—'}</td>
            </tr>
            <tr style={rowStyle((gov?.phaseProgressPct ?? 0) > 0)}>
              <td>phaseProgressPct</td><td><strong>{gov?.phaseProgressPct != null ? `${Math.round(gov.phaseProgressPct * 100)}%` : '—'}</strong></td>
            </tr>
            <tr><td>iterations</td><td>{iteration}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
