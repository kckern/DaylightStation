import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';
import { BuzzerArbiter } from "./BuzzerArbiter.js";


/**
 * Wires buzz sources into a BuzzerArbiter:
 *  - WS `party-games`/`buzz` events (MQTT relay or the debug POST /buzz endpoint)
 *  - fallback keyboard digits 1..9 → slot_1..slot_9 (playable with no hardware)
 *  - gamepads → slot `gamepad:<controllerId>` (GamepadAdapter reports every input
 *    from a team-bound controller as a semantic `gaming:interaction` press)
 * onLock(teamId) fires exactly once per armed window.
 */
export function useBuzzers({ teams, onLock, sessionId }) {
  const logger = useMemo(() => getLogger().child({ component: 'party-games-buzzers', ...(sessionId ? { sessionId } : {}) }), [sessionId]);
  const inputListeners = useRef(new Set());
  const arbiterRef = useRef(null);
  if (!arbiterRef.current) arbiterRef.current = new BuzzerArbiter(teams);
  const [locked, setLocked] = useState(null);
  const [bindingTeamId, setBindingTeamId] = useState(null);
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  const handleSlot = useCallback((slot, source) => {
    const arbiter = arbiterRef.current;
    if (arbiter.bindingTeamId) {
      if (arbiter.handleBindPress(slot)) {
        logger.info('party-games.buzzer.bound', { slot, source });
        setBindingTeamId(null);
      }
      return;
    }
    const decision = arbiter.tryBuzz(slot);
    const teamId = decision.teamId;
    if (decision.accepted) {
      logger.info('party-games.buzz.locked', { slot, teamId, source, controllerId: source === 'gamepad' ? slot.slice('gamepad:'.length) : undefined, windowKey: arbiter.windowKey, decision: 'candidate' });
      setLocked(teamId);
      onLockRef.current?.(teamId);
    } else {
      logger.sampled?.('party-games.buzz.decision', {slot,source,teamId,windowKey:arbiter.windowKey,decision:'rejected',reason:decision.reason}, {maxPerMinute:10,aggregate:true});
    }
  }, [logger]);

  useWebSocketSubscription('gaming', (msg) => {
    if (msg?.kind === 'buzz' && msg.slot) handleSlot(msg.slot, 'ws');
  }, [handleSlot]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^[1-9]$/.test(e.key)) handleSlot(`slot_${e.key}`, 'key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSlot]);

  // Gamepads are buzzer slots keyed by controller identity. GamepadAdapter
  // reports every input from a team-bound controller as a semantic press.
  useEffect(() => {
    const onInteraction = (event) => {
      const intent = event.detail;
      if (intent?.source !== 'gamepad' || !intent.controller_id) return;
      for (const listener of inputListeners.current) listener(intent);
      if (intent.phase !== 'press') return;
      handleSlot(`gamepad:${intent.controller_id}`, 'gamepad');
    };
    window.addEventListener('gaming:interaction', onInteraction);
    return () => window.removeEventListener('gaming:interaction', onInteraction);
  }, [handleSlot]);

  return {
    arbiter: arbiterRef.current,
    subscribeInput: useCallback(listener => { inputListeners.current.add(listener); return () => inputListeners.current.delete(listener); }, []),
    locked,
    bindingTeamId,
    arm: useCallback((teamIds, options) => { arbiterRef.current.arm(teamIds, options); setLocked(arbiterRef.current.lockedTeamId); }, []),
    disarm: useCallback(() => { setLocked(null); arbiterRef.current.disarm(); }, []),
    startBind: useCallback((teamId) => { arbiterRef.current.startBind(teamId); setBindingTeamId(teamId); }, []),
  };
}
