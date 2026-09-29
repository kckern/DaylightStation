// frontend/src/modules/Media/externalControl/useExternalControl.js
// Inbound commands targeting this browser's local session (C8.4): subscribe
// to client-control:<clientId>, apply via the shared command handler, ack
// every command on client-ack.
import { useEffect, useRef } from 'react';
import { subscribeTopic, publish, topics } from '../net/ws.js';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { applyCommandEnvelope } from './commandHandler.js';
import mediaLog from '../logging/mediaLog.js';

const ROUTINE_DEDUPE_STORAGE_KEY = 'media-app.routine-trigger-dedupe';

function stable(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function hash(value) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return `fallback-${(result >>> 0).toString(16).padStart(8, '0')}`;
}

function readPersistedTriggers(now) {
  try {
    const parsed = JSON.parse(globalThis.sessionStorage?.getItem(ROUTINE_DEDUPE_STORAGE_KEY) || '{}');
    return Object.fromEntries(Object.entries(parsed).filter(([, seenAt]) => Number.isFinite(seenAt) && now - seenAt <= 10_000));
  } catch {
    return {};
  }
}

function persistSuccessfulTrigger(key, seenAt) {
  try {
    const recent = readPersistedTriggers(seenAt);
    recent[key] = seenAt;
    globalThis.sessionStorage?.setItem(ROUTINE_DEDUPE_STORAGE_KEY, JSON.stringify(recent));
  } catch { /* storage is optional */ }
}

export function buildClientAck(controlClientId, message, extra) {
  return {
    topic: 'client-ack', clientId: controlClientId,
    replyToControlClientId: message.replyToControlClientId,
    commandId: message.commandId, appliedAt: new Date().toISOString(), ...extra,
  };
}

export function useExternalControl(controller) {
  const { controlClientId, controlReady } = useClientIdentity();
  const routineTriggers = useRef(new Map());
  const commandResults = useRef(new Map());

  useEffect(() => {
    if (!controlClientId || !controlReady || !controller) return undefined;
    const topic = topics.clientControl(controlClientId);
    return subscribeTopic(topic, (msg) => {
      const commandId = msg.commandId;
      if (!commandId) return;
      const ack = (extra) => publish(buildClientAck(controlClientId, msg, extra));
      let routineKey = null;
      const complete = (result, { persist = true } = {}) => {
        if (result.ok) {
          if (routineKey && persist) persistSuccessfulTrigger(routineKey, Date.now());
          mediaLog.externalControlReceived({ commandId, command: msg.command });
          ack({ ok: true });
        } else {
          if (routineKey) routineTriggers.current.delete(routineKey);
          mediaLog.externalControlRejected({ commandId, reason: result.reason });
          ack({ ok: false, error: result.reason, code: result.code, handoff: result.handoff });
        }
      };
      const replay = (entry, options = { persist: false }) => {
        if (entry.value) complete(entry.value, options);
        else entry.result.then(result => complete(result, options));
      };
      const remember = (result, options = {}, beforeComplete = null) => {
        const entry = {
          value: result?.then ? null : result,
          result: Promise.resolve(result).catch(error => ({ ok: false, reason: error?.message ?? String(error) })),
        };
        commandResults.current.set(commandId, entry);
        if (commandResults.current.size > 256) commandResults.current.delete(commandResults.current.keys().next().value);
        beforeComplete?.(entry);
        if (entry.value) complete(entry.value, options);
        else entry.result.then(value => { entry.value = value; complete(value, options); });
        return entry;
      };
      const priorCommand = commandResults.current.get(commandId);
      if (priorCommand) {
        replay(priorCommand);
        return;
      }
      if (msg.origin?.kind === 'routine') {
        const trigger = msg.origin.triggerId ?? hash(stable({
          content: msg.params,
          targetId: controlClientId,
          kind: msg.command,
        }));
        routineKey = JSON.stringify([trigger, controlClientId]);
        const now = Date.now();
        const prior = routineTriggers.current.get(routineKey);
        if (prior != null && now - prior.seenAt <= 10_000) {
          remember(prior.value ?? prior.result, { persist: false });
          return;
        }
        if (readPersistedTriggers(now)[routineKey] != null) {
          remember({ ok: true }, { persist: false });
          return;
        }
        for (const [candidate, entry] of routineTriggers.current) {
          if (now - entry.seenAt > 10_000) routineTriggers.current.delete(candidate);
        }
      }
      try {
        const result = applyCommandEnvelope(controller, msg);
        remember(result, {}, entry => {
          if (routineKey) routineTriggers.current.set(routineKey, { seenAt: Date.now(), ...entry });
        });
      } catch (err) {
        if (routineKey) routineTriggers.current.delete(routineKey);
        remember({ ok: false, reason: err?.message });
      }
    });
  }, [controlClientId, controlReady, controller]);
}

export default useExternalControl;
