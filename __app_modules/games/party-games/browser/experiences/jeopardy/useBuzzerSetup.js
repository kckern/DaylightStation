import { useEffect, useRef, useState } from 'react';
import { requiresBuzzers, commandContext, buzzersReady } from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { fetchSession } from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import { sendJeopardyCommand } from './jeopardyClient.js';

// Hardware facts originate on the TV's existing semantic input stream.
export function useBuzzerSetup({ sessionId, state, revision, buzzers, acceptSession, audio, logger }) {
  const [hardware, setHardware] = useState(null);
  const latest = useRef(state); latest.current = state;
  const acceptedRevision = useRef(revision); acceptedRevision.current = revision;
  const renew = useRef(() => {});
  const readySignature = useRef(null);
  const accept = useRef(acceptSession); accept.current = acceptSession;
  const epoch = useRef(null);
  const queue = useRef(Promise.resolve());
  const busySlots = useRef(new Set());
  const held = useRef(new Map());
  const appliedSetup = useRef(null);
  const enabled = Boolean(state && state.phase !== 'done' && requiresBuzzers(state) && buzzers.subscribeInput);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    queue.current = Promise.resolve();
    const token = crypto.randomUUID(); epoch.current = token;
    const pending = new Map();
    const scheduled = new Set();
    const receipts = new WeakMap();
    const suppressed = new Map();
    const suppress = (reason, fields = {}) => {
      const count = (suppressed.get(reason) || 0) + 1; suppressed.set(reason, count);
      if (count === 1 || count % 50 === 0) logger.info('jeopardy.buzzer.input-suppressed', { sessionId, phase: latest.current?.phase, reason, count, ...fields });
    };
    const readyState = (presence, blockers) => {
      const current = latest.current, setup = current?.buzzerSetup;
      const teams = Object.entries(setup?.teams || {}).map(([teamId, entry]) => ({ teamId, slot: entry.slot, generation: entry.generation, connected: entry.connected, tested: entry.tested }));
      const fields = { sessionId, phase: current?.phase, epoch: setup?.epoch, ready: !blockers.length && buzzersReady(current), blockers, presenceFresh: presence.fresh, teams };
      const signature = JSON.stringify(fields);
      if (readySignature.current !== signature) { readySignature.current = signature; logger.info('jeopardy.buzzer.ready-state', { ...fields, revision: acceptedRevision.current, leaseAgeMs: setup ? Date.now() - setup.seenAt : null }); }
    };
    const reportKey = command => `${command.type}:${command.teamId || ''}`;
    const acknowledged = (command, current) => {
      const setup = current?.buzzerSetup;
      if (command.type === 'BUZZER_SETUP') return setup?.epoch === command.epoch;
      const entry = setup?.teams[command.teamId];
      if (!entry) return false;
      if (command.kind === 'disconnect') return setup.epoch === command.epoch && entry.generation === command.generation + 1 && entry.slot === command.slot && !entry.connected && !entry.tested;
      return setup?.epoch === command.epoch && entry?.generation === command.generation && entry.slot === command.slot &&
        (command.kind === 'test' ? entry.tested : command.kind === 'assign' ? entry.connected : false);
    };
    const superseded = (command, current) => {
      if (command.type === 'BUZZER_SETUP') return false;
      const setup = current?.buzzerSetup;
      return setup && (setup.epoch !== command.epoch || setup.teams[command.teamId]?.generation > command.generation);
    };
    const feedback = (command, revision) => {
      const receipt = receipts.get(command);
      if (command.type === 'BUZZER_PRESENCE') return;
      logger.info('jeopardy.buzzer.report-result', { sessionId, type: command.type, teamId: command.teamId, slot: command.slot, epoch: command.epoch, generation: command.generation, kind: command.kind, revision, commandId: receipt?.commandId, elapsedMs: performance.now() - (receipt?.startedAt ?? performance.now()), result: 'accepted' });
      if (command.kind === 'test') audio.play('buzz', { pack: 'jeopardy' });
    };
    const presenceBlocker = (authority = latest.current) => {
      if (pending.size) return 'safety-report-pending';
      if (latest.current?.phase !== 'round-intro' || authority?.phase !== 'round-intro') return 'left-ready';
      if (latest.current?.buzzerSetup?.epoch !== token || authority?.buzzerSetup?.epoch !== token) return 'setup-unconfirmed';
      const presence = buzzers.presence?.() || { fresh: false, slots: [] };
      if (!presence.fresh) return 'hardware-stale';
      for (const current of [latest.current, authority]) {
        if (current.teamIds.some(id => { const entry = current.buzzerSetup.teams[id]; return !entry?.connected || !entry.tested || !entry.slot || !presence.slots.includes(entry.slot); })) return 'hardware-not-ready';
      }
      return null;
    };
    const canRenew = authority => {
      const reason = presenceBlocker(authority);
      if (reason) logger.sampled?.('jeopardy.buzzer.presence-suppressed', { sessionId, reason }, { maxPerMinute: 5, aggregate: true });
      return !reason;
    };
    const send = command => {
      if (scheduled.has(command)) return queue.current;
      scheduled.add(command);
      if (!receipts.has(command)) receipts.set(command, { commandId: `cmd:${crypto.randomUUID()}`, logicalTime: Date.now(), startedAt: performance.now() });
      const key = reportKey(command);
      if (command.type !== 'BUZZER_PRESENCE') pending.set(key, command);
      queue.current = queue.current.then(async () => {
        if (!active) return false;
        // Never renew stale readiness while any safety transition lacks an ack.
        if (command.type === 'BUZZER_PRESENCE' && !canRenew()) return false;
        try {
          const receipt = receipts.get(command);
          if (command.type !== 'BUZZER_PRESENCE') logger.info('jeopardy.buzzer.report-sent', { sessionId, type: command.type, teamId: command.teamId, slot: command.slot, epoch: token, generation: command.generation, kind: command.kind, commandId: receipt.commandId });
          const result = await sendJeopardyCommand(sessionId, command, { commandId: receipt.commandId, logicalTime: receipt.logicalTime, expectedRevision: acceptedRevision.current >= 0 ? acceptedRevision.current : undefined, expectedContext: commandContext(latest.current), ...(command.type === 'BUZZER_PRESENCE' ? { canSend: canRenew } : {}) });
          if (!active) return false;
          acceptedRevision.current = result.header?.revision;
          accept.current(result);
          if (command.type !== 'BUZZER_PRESENCE' && !acknowledged(command, result.state)) {
            logger.warn('jeopardy.buzzer.report-unconfirmed', { sessionId, teamId: command.teamId, slot: command.slot, kind: command.kind, commandId: receipt.commandId, revision: result.header?.revision, retryPending: true });
            return false;
          }
          if (pending.get(key) === command) pending.delete(key); feedback(command, result.header?.revision);
          return true;
        } catch (cause) {
          if (!active || cause.code === 'command_superseded') return false;
          // A lost response may have committed. Reconcile before retrying a
          // generation-changing disconnect or emitting successful feedback.
          try {
            const result = await fetchSession(sessionId);
            if (!active) return false;
            acceptedRevision.current = result.header?.revision;
            accept.current(result);
            if (acknowledged(command, result.state)) { if (pending.get(key) === command) pending.delete(key); feedback(command, result.header?.revision); return true; }
            if (superseded(command, result.state)) {
              if (pending.get(key) === command) pending.delete(key);
              logger.info('jeopardy.buzzer.report-superseded', { sessionId, teamId: command.teamId, slot: command.slot, kind: command.kind, commandId: receipts.get(command)?.commandId, generation: command.generation, currentGeneration: result.state.buzzerSetup?.teams[command.teamId]?.generation });
              return false;
            }
          } catch { /* retain pending facts until authority can be reached */ }
          logger.warn('jeopardy.buzzer-report-failed', { sessionId, teamId: command.teamId, slot: command.slot, epoch: token, generation: command.generation, commandId: receipts.get(command)?.commandId, type: command.type, kind: command.kind, code: cause.code || cause.body?.error, message: cause.message, retryPending: pending.has(key) });
          return false;
        }
      });
      queue.current = queue.current.finally(() => scheduled.delete(command));
      return queue.current;
    };
    const retryFacts = () => { for (const command of [...pending.values()]) send(command); };
    const reconcile = () => {
      if (latest.current?.phase !== 'round-intro') return;
      const presence = buzzers.presence?.() || { fresh: false, slots: [] };
      setHardware(presence);
      const setup = latest.current?.buzzerSetup;
      const blockers = [];
      if (pending.size) blockers.push('report-pending');
      if (!presence.fresh) blockers.push('hardware-stale');
      if (setup?.epoch !== token) blockers.push('setup-unconfirmed');
      if (presence.fresh && setup?.epoch === token) {
        for (const [teamId, entry] of Object.entries(setup.teams)) {
          if (!entry.slot) { blockers.push(`${teamId}:unassigned`); continue; }
          if (!presence.slots.includes(entry.slot)) {
            blockers.push(`${teamId}:missing`);
            if ((entry.connected || entry.tested) && !busySlots.current.has(entry.slot) && ![...pending.values()].some(command => command.slot === entry.slot)) {
              busySlots.current.add(entry.slot);
              send({ type: 'BUZZER_REPORT', kind: 'disconnect', epoch: token, generation: entry.generation, teamId, slot: entry.slot }).finally(() => busySlots.current.delete(entry.slot));
            }
          } else if (!entry.connected || !entry.tested) blockers.push(`${teamId}:retest`);
        }
      }
      readyState(presence, blockers);
      if (pending.size) retryFacts();
      else if (!blockers.length) send({ type: 'BUZZER_PRESENCE', epoch: token });
    };
    renew.current = reconcile;
    send({ type: 'BUZZER_SETUP', epoch: token });
    // Safety facts can retry during play; this timer never renews a lease.
    const safetyRetry = setInterval(retryFacts, 5000);
    const online = () => { retryFacts(); reconcile(); };
    window.addEventListener('online', online);
    const disconnect = event => {
      const slot = `gamepad:${event.gamepad.index}:${event.gamepad.id}`;
      const setup = latest.current?.buzzerSetup;
      if (setup?.epoch !== token) return;
      for (const [teamId, entry] of Object.entries(setup.teams)) {
        if (entry.slot !== slot) continue;
        busySlots.current.add(slot);
        logger.info('jeopardy.buzzer-disconnected', { sessionId, teamId, slot, epoch: token, generation: entry.generation, phase: latest.current?.phase });
        send({ type: 'BUZZER_REPORT', kind: 'disconnect', epoch: token, generation: entry.generation, teamId, slot }).finally(() => busySlots.current.delete(slot));
      }
    };
    window.addEventListener('gamepaddisconnected', disconnect);
    const unsubscribe = buzzers.subscribeInput(intent => {
      const controller = intent.controller_id;
      let buttons = held.current.get(controller);
      if (!buttons) { buttons = new Set(); held.current.set(controller, buttons); }
      if (intent.phase === 'release') { buttons.delete(intent.action); return; }
      const wasHeld = buttons.size > 0; buttons.add(intent.action);
      if (intent.phase !== 'press' || wasHeld) { if (intent.phase === 'press') suppress('held', { controller }); return; }
      const current = latest.current;
      const setup = current?.buzzerSetup;
      if (current?.phase !== 'round-intro' || setup?.epoch !== token) { suppress(current?.phase !== 'round-intro' ? 'outside-ready' : 'setup-unconfirmed', { controller }); return; }
      const slot = `gamepad:${controller}`;
      if (busySlots.current.has(slot) || [...pending.values()].some(command => command.slot === slot)) { suppress('report-pending', { slot }); return; }
      const entries = current.teamIds.map(id => [id, setup.teams[id]]);
      const owner = entries.find(([, entry]) => entry.slot === slot);
      const guided = entries.find(([, entry]) => !entry.tested || !entry.connected);
      const reservedTeams = new Set([...pending.values()].map(command => command.teamId));
      const pendingTeam = guided && !guided[1].slot && !reservedTeams.has(guided[0]) ? guided : null;
      // A known controller tests its own mapping, never claims the next team.
      const target = owner || pendingTeam;
      if (!target) { suppress('awaiting-other-team', { slot }); return; }
      const [teamId, entry] = target;
      if (owner && entry.tested) { suppress('already-tested', { slot, teamId }); return; }
      const kind = owner ? 'test' : 'assign';
      busySlots.current.add(slot);
      send({ type: 'BUZZER_REPORT', epoch: token, generation: entry.generation, teamId, slot, kind }).finally(() => busySlots.current.delete(slot));
    });
    return () => {
      active = false; renew.current = () => {}; clearInterval(safetyRetry); unsubscribe();
      window.removeEventListener('gamepaddisconnected', disconnect); window.removeEventListener('online', online);
      if (suppressed.size) logger.info('jeopardy.buzzer.input-summary', { sessionId, counts: Object.fromEntries(suppressed) });
      held.current.clear(); busySlots.current.clear(); readySignature.current = null;
    };
  }, [enabled, sessionId, buzzers, audio, logger]);
  useEffect(() => {
    if (!enabled || state.phase !== 'round-intro') return undefined;
    renew.current();
    const heartbeat = setInterval(() => renew.current(), 5000);
    return () => clearInterval(heartbeat);
  }, [enabled, state?.phase, sessionId]);
  useEffect(() => {
    if (!enabled || state.phase !== 'round-intro') return undefined;
    return buzzers.capture?.();
  }, [enabled, state?.phase, buzzers]);
  useEffect(() => {
    if (!enabled || !state.buzzerSetup) return;
    setHardware(buzzers.presence?.() || null);
    const bindings = Object.fromEntries(Object.entries(state.buzzerSetup.teams).filter(([, entry]) => entry.slot).map(([id, entry]) => [entry.slot, id]));
    const signature = JSON.stringify({ epoch: state.buzzerSetup.epoch, teams: state.buzzerSetup.teams, ready: buzzersReady(state) });
    if (appliedSetup.current !== signature) {
      appliedSetup.current = signature;
      logger.info('jeopardy.buzzer.readiness-changed', { sessionId, phase: state.phase, ready: buzzersReady(state), revision, leaseAgeMs: Date.now() - state.buzzerSetup.seenAt, epoch: state.buzzerSetup.epoch, teams: Object.entries(state.buzzerSetup.teams).map(([teamId, entry]) => ({ teamId, slot: entry.slot, generation: entry.generation, connected: entry.connected, tested: entry.tested })) });
    }
    buzzers.restore?.(bindings);
  }, [enabled, state?.buzzerSetup, state?.phase, buzzers]);
  return hardware;
}
