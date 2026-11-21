// remoteButtonsContext — the remote-button state RemoteButtonsHost provides,
// and the `bluetooth` object a Bluetooth screen host passes on: the fitness
// Bluetooth feed plus `remoteButtons` (null outside a RemoteButtonsHost).
import { createContext, useContext, useEffect, useMemo } from 'react';
import { holdRemoteButtons } from './remoteButtonRuntime.js';
import { useFitnessBluetoothState } from '../../context/FitnessBluetoothContext.jsx';

export const RemoteButtonsContext = createContext(null);
export function useRemoteButtons() { return useContext(RemoteButtonsContext); }

export function useBluetoothScreenBluetooth() {
  const base = useFitnessBluetoothState()?.bluetooth || null;
  const remoteButtons = useRemoteButtons();
  return useMemo(() => (base ? { ...base, remoteButtons } : null), [base, remoteButtons]);
}

/**
 * While `active`, the remote-button runtime performs no saved action and lets
 * every key through: for a screen that reads remote presses itself (a game
 * subscribing to `bt.remote.key`). `reason` shows in the `.held` log.
 */
export function useRemoteButtonsHold(active, reason) {
  useEffect(() => (active ? holdRemoteButtons(reason) : undefined), [active, reason]);
}
