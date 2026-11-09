import React from 'react';
import ControllerManager from './ControllerManager.jsx';
import { currentBluetoothDeviceId } from '../input/bluetoothClient.js';

/** Home-menu app (`app:controllers`): the controller manager for this screen's own device. */
export default function ControllersApp({ clear }) {
  return <ControllerManager deviceId={currentBluetoothDeviceId()} onClose={clear} />;
}
