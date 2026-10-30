/**
 * Drives the presence gate for one entry surface (a show, or a playing item).
 *
 * An entry is ADMITTED the first moment the gate does not require an unlock
 * (adult home, gate off, or an admin unlock in force), and stays admitted until
 * the key changes — so the adult leaving mid-video never interrupts what is
 * already playing; only the next show/video is gated. A blocked entry opens the
 * existing admin fingerprint prompt (IdentityProvider.registerAdmin) once per key.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { useIdentity } from '../identity/useIdentity.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'presence-gate' }));

export const PRESENCE_GATE_LOCK = 'presence_gate';

/**
 * @param {object} gate  usePresenceGate(kind) result
 * @param {string|null} key  the entry (show id / item id); null = nothing to gate
 * @param {{ kind: 'play'|'show', onDismiss?: () => void }} opts
 */
export default function usePresenceGatePrompt(gate, key, { kind, onDismiss } = {}) {
  const { registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();
  const [admittedKey, setAdmittedKey] = useState(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const promptedKeyRef = useRef(null);
  const requestRef = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const blocked = key != null && admittedKey !== key && gate.required;

  // Admit the entry as soon as the gate lets it through.
  useEffect(() => {
    if (key != null && admittedKey !== key && !gate.required) setAdmittedKey(key);
  }, [key, admittedKey, gate.required]);

  const startPrompt = useCallback(() => {
    const reqKey = keyRef.current;
    promptedKeyRef.current = reqKey;
    const req = ++requestRef.current;
    logger().info('fitness.presence_gate.blocked', { kind, key: reqKey, reason: gate.reason });
    setOpen(true);
    registerAdmin(PRESENCE_GATE_LOCK).then((verdict) => {
      if (req !== requestRef.current) return; // superseded (key changed / adult came home)
      setOpen(false);
      if (verdict?.matched) {
        gate.grant({ userId: verdict.userId ?? null });
        clearUnlock();
        return;
      }
      logger().info('fitness.presence_gate.dismissed', { kind, key: reqKey });
      onDismissRef.current?.();
    });
  }, [registerAdmin, clearUnlock, gate, kind]);

  useEffect(() => {
    if (!blocked || !gate.settled) {
      // No longer needed (adult came home, key changed): retire an open prompt.
      if (openRef.current && !blocked) {
        requestRef.current += 1;
        setOpen(false);
        clearUnlock();
      }
      return;
    }
    if (openRef.current || promptedKeyRef.current === key) return;
    startPrompt();
  }, [blocked, gate.settled, key, startPrompt, clearUnlock]);

  // Cancel / timeout / close from the prompt. clearUnlock resolves the pending
  // verdict (a grant already decided during the chime hold still counts).
  const cancel = useCallback(() => { clearUnlock(); }, [clearUnlock]);

  return { blocked, open, state: unlockState, unlockedUser, cancel, retry: startPrompt };
}
