import { useEffect, useRef } from 'react';
import { requiresBuzzers } from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { fetchSession } from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import { sendJeopardyCommand } from './jeopardyClient.js';

// Hardware facts originate on the TV's existing semantic input stream.
export function useBuzzerSetup({ sessionId, state, buzzers, acceptSession, audio, logger }) {
  const latest = useRef(state); latest.current = state;
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
    const token = crypto.randomUUID(); epoch.current = token;
    const pending = new Map();
    const scheduled = new Set();
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
      if (!command.kind || command.kind === 'disconnect') return;
      logger.info('jeopardy.buzzer.report-result', { sessionId, teamId: command.teamId, epoch: command.epoch, generation: command.generation, kind: command.kind, revision, result: 'accepted' });
      if (command.kind === 'test') audio.play('buzz', { pack: 'jeopardy' });
    };
    const send = command => {
      if (scheduled.has(command)) return queue.current;
      scheduled.add(command);
      const key = reportKey(command);
      if (command.type !== 'BUZZER_PRESENCE') pending.set(key, command);
      queue.current = queue.current.then(async () => {
        if (!active) return false;
        // Never renew stale readiness while any safety transition lacks an ack.
        if (command.type === 'BUZZER_PRESENCE' && pending.size) return false;
        try {
          const result = await sendJeopardyCommand(sessionId, command);
          if (!active) return false;
          accept.current(result);
          if (command.type !== 'BUZZER_PRESENCE' && !acknowledged(command, result.state)) return false;
          if (pending.get(key) === command) pending.delete(key); feedback(command, result.header?.revision);
          return true;
        } catch (cause) {
          if (!active) return false;
          // A lost response may have committed. Reconcile before retrying a
          // generation-changing disconnect or emitting successful feedback.
          try {
            const result = await fetchSession(sessionId);
            if (!active) return false;
            accept.current(result);
            if (acknowledged(command, result.state)) { if (pending.get(key) === command) pending.delete(key); feedback(command, result.header?.revision); return true; }
            if (superseded(command, result.state)) { if (pending.get(key) === command) pending.delete(key); return false; }
          } catch { /* retain pending facts until authority can be reached */ }
          logger.warn('jeopardy.buzzer-report-failed', { type: command.type, kind: command.kind, message: cause.message, retryPending: pending.has(key) });
          return false;
        }
      });
      queue.current = queue.current.finally(() => scheduled.delete(command));
      return queue.current;
    };
    const reconcile = () => {
      if (pending.size) for (const command of [...pending.values()]) send(command);
      else send({ type: 'BUZZER_PRESENCE', epoch: token });
    };
    send({ type: 'BUZZER_SETUP', epoch: token });
    const heartbeat = setInterval(reconcile, 5000);
    window.addEventListener('online', reconcile);
    const disconnect = event => {
      const slot = `gamepad:${event.gamepad.index}:${event.gamepad.id}`;
      const setup = latest.current?.buzzerSetup;
      if (setup?.epoch !== token) return;
      for (const [teamId, entry] of Object.entries(setup.teams)) {
        if (entry.slot !== slot) continue;
        busySlots.current.add(slot);
        logger.info('jeopardy.buzzer-disconnected', { teamId });
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
      if (intent.phase !== 'press' || wasHeld) return;
      const current = latest.current;
      const setup = current?.buzzerSetup;
      if (current?.phase !== 'round-intro' || setup?.epoch !== token) return;
      const slot = `gamepad:${controller}`;
      if (busySlots.current.has(slot) || [...pending.values()].some(command => command.slot === slot)) return;
      const entries = current.teamIds.map(id => [id, setup.teams[id]]);
      const owner = entries.find(([, entry]) => entry.slot === slot);
      const guided = entries.find(([, entry]) => !entry.tested || !entry.connected);
      const reservedTeams = new Set([...pending.values()].map(command => command.teamId));
      const pendingTeam = guided && !guided[1].slot && !reservedTeams.has(guided[0]) ? guided : null;
      // A known controller tests its own mapping, never claims the next team.
      const target = owner || pendingTeam;
      if (!target) return;
      const [teamId, entry] = target;
      if (owner && entry.tested) return;
      const kind = owner ? 'test' : 'assign';
      busySlots.current.add(slot);
      send({ type: 'BUZZER_REPORT', epoch: token, generation: entry.generation, teamId, slot, kind }).finally(() => busySlots.current.delete(slot));
    });
    return () => { active = false; clearInterval(heartbeat); unsubscribe(); window.removeEventListener('gamepaddisconnected', disconnect); window.removeEventListener('online', reconcile); held.current.clear(); busySlots.current.clear(); };
  }, [enabled, sessionId, buzzers, audio, logger]);
  useEffect(() => {
    if (!enabled || state.phase !== 'round-intro') return undefined;
    return buzzers.capture?.();
  }, [enabled, state?.phase, buzzers]);
  useEffect(() => {
    if (!enabled || !state.buzzerSetup) return;
    const bindings = Object.fromEntries(Object.entries(state.buzzerSetup.teams).filter(([, entry]) => entry.slot).map(([id, entry]) => [entry.slot, id]));
    const signature = JSON.stringify({ epoch: state.buzzerSetup.epoch, teams: state.buzzerSetup.teams });
    if (appliedSetup.current !== signature) {
      appliedSetup.current = signature;
      logger.info('jeopardy.buzzer.readiness-changed', { sessionId, epoch: state.buzzerSetup.epoch, teams: Object.entries(state.buzzerSetup.teams).map(([teamId, entry]) => ({ teamId, generation: entry.generation, connected: entry.connected, tested: entry.tested })) });
    }
    buzzers.restore?.(bindings);
  }, [enabled, state?.buzzerSetup, buzzers]);
}
