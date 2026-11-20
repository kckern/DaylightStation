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

/** `{ bluetooth, pairController }` from the nearest fitness host, or null outside one. */
export function useFitnessBluetoothState() {
  return useContext(FitnessBluetoothContext);
}

/**
 * The old Controllers panel's prop names, from the host's state; `fallback`
 * (a context-shaped object) fills them outside a host. Goes with that panel.
 */
export function bluetoothLegacyFields(state, fallback = null) {
  if (!state?.bluetooth) {
    return {
      controllerPairing: fallback?.controllerPairing ?? null,
      controllerForget: fallback?.controllerForget ?? null,
      pairController: fallback?.pairController,
      forgetController: fallback?.forgetController,
    };
  }
  return {
    controllerPairing: state.bluetooth.pairing,
    controllerForget: state.bluetooth.forgetResult,
    pairController: state.pairController,
    forgetController: state.bluetooth.forget,
  };
}

export function FitnessBluetoothHost({ send, registerRef, onInventory, children }) {
  const { bluetooth, handleMessage, noteHealth, pairController, resetScan } = useFitnessBluetooth({ send });
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
  const value = useMemo(() => ({ bluetooth, pairController }), [bluetooth, pairController]);
  return <FitnessBluetoothContext.Provider value={value}>{children}</FitnessBluetoothContext.Provider>;
}

export default FitnessBluetoothHost;
