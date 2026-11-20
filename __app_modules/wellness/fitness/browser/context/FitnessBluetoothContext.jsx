// FitnessBluetoothContext — the fitness host's Bluetooth state in its own
// context, so a running search (a `bt.scan.progress` about once a second)
// re-renders only the Bluetooth screen, not every useFitnessContext consumer.
//
// FitnessProvider renders <FitnessBluetoothHost> around its children. The
// host owns useFitnessBluetooth and registers its bus entry points into the
// provider's `registerRef` (the provider's single bus subscription calls them).
// `children` arrive as the provider's own element, so a host re-render does
// not re-render them. Only the inventory (it changes rarely; EmulatorToasts
// and the arcade read it) is handed back up to the main context.
import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useFitnessBluetooth } from './useFitnessBluetooth.js';

export const FitnessBluetoothContext = createContext(null);

/** `{ bluetooth }` from the nearest fitness host, or null outside one. */
export function useFitnessBluetoothState() {
  return useContext(FitnessBluetoothContext);
}

export function FitnessBluetoothHost({ send, registerRef, onInventory, children }) {
  const { bluetooth, handleMessage, noteHealth, resetScan } = useFitnessBluetooth({ send });
  if (registerRef) {
    registerRef.current = {
      handleBtMessage: handleMessage,
      noteBtHealth: noteHealth,
      requestInventory: bluetooth.requestInventory,
      onReconnect: resetScan,
    };
  }
  const inventory = bluetooth.inventory;
  useEffect(() => { onInventory?.(inventory); }, [inventory, onInventory]);
  const value = useMemo(() => ({ bluetooth }), [bluetooth]);
  return <FitnessBluetoothContext.Provider value={value}>{children}</FitnessBluetoothContext.Provider>;
}

export default FitnessBluetoothHost;
