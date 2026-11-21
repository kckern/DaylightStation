import { useMemo } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { useFitnessBluetoothState } from '../../context/FitnessBluetoothContext.jsx';
import { BluetoothRemoteDirectionSource } from '../../lib/remoteInput/BluetoothRemoteDirectionSource.js';
import { useSkylineRemote } from './useSkylineRemote.js';

// Composition: builds the remote-direction adapter for this host (the
// per-remote Bluetooth feed + the remote inventory) and hands it to Glider's
// vendor-free hook. Renders nothing. Reading the Bluetooth context here keeps
// an inventory or search update from re-rendering the flight. Glider keeps
// this as the first child of every screen, so it stays mounted from lobby to
// flight and back. The inventory is fetched only when a bike maps remotes.
const loadControllers = () => DaylightAPI('api/v1/emulator/library')
  .then((lib) => (Array.isArray(lib?.input?.controllers) ? lib.input.controllers : []));

export default function SkylineRemoteInput({ remoteConfig, onPress, log }) {
  const subscribeRemoteKeys = useFitnessBluetoothState()?.bluetooth?.subscribeRemoteKeys || null;
  const source = useMemo(() => (typeof subscribeRemoteKeys === 'function'
    ? new BluetoothRemoteDirectionSource({ subscribeRemoteKeys, loadControllers, log })
    : null), [subscribeRemoteKeys, log]);
  useSkylineRemote({ source, remoteConfig, onPress, log });
  return null;
}
