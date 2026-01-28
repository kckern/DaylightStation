/**
 * Devices Application Module
 *
 * Device registry with capability-based control. Devices declare
 * what they can do, and the system routes commands appropriately.
 *
 * Capabilities:
 * - device_control: Hardware power, state (via Home Assistant)
 * - os_control: OS-level commands, volume (via SSH)
 * - content_control: Display content loading (via Fully Kiosk, WebSocket)
 *
 * @module applications/devices
 */

export { Device, DeviceService } from './services/index.mjs';

export {
  isDeviceControl,
  assertDeviceControl,
  createNoOpDeviceControl,
  isOsControl,
  assertOsControl,
  createNoOpOsControl,
  isContentControl,
  assertContentControl,
  createNoOpContentControl
} from './ports/index.mjs';
