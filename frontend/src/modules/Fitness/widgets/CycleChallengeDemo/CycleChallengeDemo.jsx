import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import './CycleChallengeDemo.scss';

/**
 * CycleChallengeDemo
 *
 * Production debug widget for the cycle-challenge feature. Renders as an
 * overlay panel on top of FitnessPlayer when the URL contains `?cycle-demo=1`.
 *
 * Capabilities:
 *   - One-click Trigger / Remove / Reset of a cycle challenge
 *   - RPM presets (0 / 35 / 75 / 100 / 120) with sustain
 *   - Start / stop simulated HR sessions for cycle-eligible riders
 *   - Live telemetry pulled every 500ms from window.__fitnessGovernance,
 *     __fitnessSimController, and the active equipment cadence map
 *   - Inline event tail (last 10 cycle.* events the engine emitted in this
 *     session, captured via console-mirroring of getLogger output)
 */
const RPM_PRESETS = [0, 35, 75, 100, 120];

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
    phaseProgressPct: g.phaseProgressPct,
    videoLocked: g.videoLocked,
    contentId: g.contentId
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

export default function CycleChallengeDemo({ onClose }) {
  const logger = useMemo(() => getLogger().child({ component: 'cycle-challenge-demo' }), []);

  const [tick, setTick] = useState(0);
  const [actionLog, setActionLog] = useState([]);
  const sustainRef = useRef(null);

  // Pulse every 500ms so telemetry stays live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1000000), 500);
    return () => clearInterval(id);
  }, []);

  // Tear down RPM sustain when the panel unmounts.
  useEffect(() => () => {
    if (sustainRef.current) clearInterval(sustainRef.current);
  }, []);

  const ctl = typeof window !== 'undefined' ? window.__fitnessSimController : null;

  const equipment = useMemo(() => {
    if (!ctl) return [];
    try { return ctl.getEquipment?.() || []; } catch (_) { return []; }
  }, [ctl, tick]);

  const cycleAce = equipment.find((e) => e.equipmentId === 'cycle_ace') || null;

  const selections = useMemo(() => {
    if (!ctl) return [];
    try { return ctl.listCycleSelections?.() || []; } catch (_) { return []; }
  }, [ctl, tick]);
  const selection = selections.find((s) => s.equipment === 'cycle_ace') || null;

  const gov = safeReadGov();
  const session = safeReadSession();

  // Keep last N actions in a tiny log.
  const pushAction = useCallback((label, detail) => {
    const entry = {
      ts: new Date().toLocaleTimeString(),
      label,
      detail: detail ? JSON.stringify(detail) : ''
    };
    setActionLog((prev) => [entry, ...prev].slice(0, 10));
    logger.info('action', { label, detail });
  }, [logger]);

  const setSustainedRpm = useCallback((rpm) => {
    if (sustainRef.current) {
      clearInterval(sustainRef.current);
      sustainRef.current = null;
    }
    if (!ctl) return;
    if (rpm === 0) {
      ctl.setRpm('cycle_ace', 0);
      pushAction('setRpm', { rpm: 0 });
      return;
    }
    ctl.setRpm('cycle_ace', rpm);
    sustainRef.current = setInterval(() => {
      ctl.setRpm('cycle_ace', rpm);
    }, 1000);
    pushAction('setRpm sustained', { rpm });
  }, [ctl, pushAction]);

  const handleTrigger = useCallback(() => {
    if (!ctl) return;
    if (!selection) { pushAction('trigger ABORT', { reason: 'no_selection' }); return; }
    const riderId = cycleAce?.eligibleUsers?.[0];
    const result = ctl.triggerCycleChallenge({
      selectionId: selection.id,
      riderId
    });
    pushAction('trigger', { selectionId: selection.id, riderId, result });
  }, [ctl, selection, cycleAce, pushAction]);

  const handleRemove = useCallback(() => {
    // No public "clear" method on the controller — we hit the engine directly.
    if (typeof window === 'undefined') return;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    if (engine?.challengeState) {
      engine.challengeState.activeChallenge = null;
      engine._updateGlobalState?.();
      pushAction('remove', { ok: true });
    } else {
      pushAction('remove ABORT', { reason: 'no_engine' });
    }
  }, [pushAction]);

  const handleReset = useCallback(() => {
    handleRemove();
    setTimeout(() => handleTrigger(), 100);
  }, [handleRemove, handleTrigger]);

  const handleStartHr = useCallback(() => {
    if (!ctl) return;
    const devices = ctl.getDevices?.() || [];
    devices.slice(0, 2).forEach((d) => ctl.startAutoSession(d.deviceId, { phaseOffset: 200 }));
    pushAction('startHr', { count: Math.min(2, devices.length) });
  }, [ctl, pushAction]);

  const handleStopHr = useCallback(() => {
    if (!ctl) return;
    ctl.stopAll?.();
    pushAction('stopHr');
  }, [ctl, pushAction]);

  const handleSwap = useCallback(() => {
    if (!ctl) return;
    const eligible = cycleAce?.eligibleUsers || [];
    const currentRider = gov?.riderId;
    const next = eligible.find((u) => u !== currentRider);
    if (!next) { pushAction('swap ABORT', { reason: 'no_other_rider' }); return; }
    const result = ctl.swapCycleRider(next, { force: true });
    pushAction('swap', { next, result });
  }, [ctl, cycleAce, gov?.riderId, pushAction]);

  // Derive the lock reason from window globals — exposed by the engine on
  // the active challenge but not on __fitnessGovernance directly. Read it
  // through the session reference if available.
  const lockReason = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    return engine?.challengeState?.activeChallenge?.lockReason || null;
  }, [tick]);

  const baseReq = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    if (!engine) return null;
    const active = engine.challengeState?.activeChallenge;
    if (!active) return null;
    return {
      paused: active._pausedAt != null,
      lastEvalTs: active._lastCycleTs ? new Date(active._lastCycleTs).toLocaleTimeString() : null
    };
  }, [tick]);

  const cadence = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const session = window.__fitnessSession;
    const engine = session?.governanceEngine || session?.session?.governanceEngine;
    return engine?._latestInputs?.equipmentCadenceMap?.cycle_ace || null;
  }, [tick]);

  const rowStyle = (active) => ({
    background: active ? 'rgba(34,197,94,0.16)' : 'transparent',
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
        <div className="cycle-challenge-demo__section-title">Controls</div>
        <div className="cycle-challenge-demo__btn-row">
          <button onClick={handleStartHr}>Start HR</button>
          <button onClick={handleStopHr}>Stop HR</button>
        </div>
        <div className="cycle-challenge-demo__btn-row">
          <button onClick={handleTrigger}>Trigger</button>
          <button onClick={handleSwap}>Swap Rider</button>
          <button onClick={handleRemove}>Remove</button>
          <button onClick={handleReset}>Reset</button>
        </div>
        <div className="cycle-challenge-demo__btn-row">
          {RPM_PRESETS.map((rpm) => (
            <button key={rpm} onClick={() => setSustainedRpm(rpm)}>
              {rpm} RPM
            </button>
          ))}
        </div>
      </div>

      <div className="cycle-challenge-demo__section">
        <div className="cycle-challenge-demo__section-title">Telemetry</div>
        <table className="cycle-challenge-demo__table">
          <tbody>
            <tr><td>governance.phase</td><td>{gov?.phase || '—'}</td></tr>
            <tr><td>contentId</td><td>{gov?.contentId || '—'}</td></tr>
            <tr><td>session.active</td><td>{String(session?.sessionActive ?? '—')}</td></tr>
            <tr><td>roster / devices</td><td>{session ? `${session.rosterSize} / ${session.deviceCount}` : '—'}</td></tr>
            <tr style={rowStyle(gov?.activeChallengeType === 'cycle')}>
              <td>activeChallengeType</td><td>{gov?.activeChallengeType || '—'}</td>
            </tr>
            <tr><td>challengeId</td><td>{gov?.activeChallenge || '—'}</td></tr>
            <tr><td>equipment</td><td>{gov?.activeChallengeEquipment || '—'}</td></tr>
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
            <tr><td>phaseProgressPct</td><td>{gov?.phaseProgressPct != null ? `${gov.phaseProgressPct}%` : '—'}</td></tr>
            <tr><td>paused</td><td>{baseReq?.paused ? 'YES (base req fail)' : 'no'}</td></tr>
            <tr><td>lastEvalTs</td><td>{baseReq?.lastEvalTs || '—'}</td></tr>
            <tr><td>videoLocked</td><td>{String(gov?.videoLocked ?? false)}</td></tr>
          </tbody>
        </table>
      </div>

      {cycleAce ? (
        <div className="cycle-challenge-demo__section">
          <div className="cycle-challenge-demo__section-title">Equipment</div>
          <div className="cycle-challenge-demo__equipment">
            {cycleAce.name} (id={cycleAce.equipmentId}, cad={cycleAce.cadenceDeviceId})
            <br />
            eligible: {cycleAce.eligibleUsers.join(', ') || '(none)'}
          </div>
        </div>
      ) : (
        <div className="cycle-challenge-demo__section cycle-challenge-demo__warn">
          ⚠ cycle_ace not in equipment catalog — Tasks 1-2 (catalog wiring) may have regressed.
        </div>
      )}

      <div className="cycle-challenge-demo__section">
        <div className="cycle-challenge-demo__section-title">Action log (latest 10)</div>
        <div className="cycle-challenge-demo__log">
          {actionLog.length === 0 ? <em>(no actions yet)</em> : actionLog.map((a, i) => (
            <div key={i} className="cycle-challenge-demo__log-row">
              <span className="cycle-challenge-demo__log-ts">{a.ts}</span>
              <span className="cycle-challenge-demo__log-label">{a.label}</span>
              <span className="cycle-challenge-demo__log-detail">{a.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
