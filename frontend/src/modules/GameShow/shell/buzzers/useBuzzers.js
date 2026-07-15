import { useRef, useEffect, useState, useCallback } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';
import { BuzzerArbiter } from './BuzzerArbiter.js';

const log = () => getLogger().child({ component: 'gameshow-buzzers' });

/**
 * Wires buzz sources into a BuzzerArbiter:
 *  - WS `gameshow`/`buzz` events (MQTT relay or the debug POST /buzz endpoint)
 *  - fallback keyboard digits 1..9 → slot_1..slot_9 (playable with no hardware)
 * onLock(teamId) fires exactly once per armed window.
 */
export function useBuzzers({ teams, onLock }) {
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
        log().info('gameshow.buzzer.bound', { slot, source });
        setBindingTeamId(null);
      }
      return;
    }
    const teamId = arbiter.handleBuzz(slot);
    if (teamId) {
      log().info('gameshow.buzz.locked', { slot, teamId, source });
      setLocked(teamId);
      onLockRef.current?.(teamId);
    }
  }, []);

  useWebSocketSubscription('gameshow', (msg) => {
    if (msg?.kind === 'buzz' && msg.slot) handleSlot(msg.slot, 'ws');
  }, [handleSlot]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^[1-9]$/.test(e.key)) handleSlot(`slot_${e.key}`, 'key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSlot]);

  return {
    arbiter: arbiterRef.current,
    locked,
    bindingTeamId,
    arm: useCallback((teamIds) => { setLocked(null); arbiterRef.current.arm(teamIds); }, []),
    disarm: useCallback(() => { setLocked(null); arbiterRef.current.disarm(); }, []),
    startBind: useCallback((teamId) => { arbiterRef.current.startBind(teamId); setBindingTeamId(teamId); }, []),
  };
}
