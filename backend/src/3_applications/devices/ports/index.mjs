/**
 * Device Capability Ports
 * @module applications/devices/ports
 */

export {
  isDeviceControl,
  assertDeviceControl,
  createNoOpDeviceControl
} from './IDeviceControl.mjs';

export {
  isOsControl,
  assertOsControl,
  createNoOpOsControl
} from './IOsControl.mjs';

export {
  isContentControl,
  assertContentControl,
  createNoOpContentControl
} from './IContentControl.mjs';
