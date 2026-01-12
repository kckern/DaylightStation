/**
 * Home Automation Adapters
 * @module adapters/home-automation
 *
 * Provider implementations for IHomeAutomationGateway and device adapters.
 */

// Gateway implementations
export { HomeAssistantAdapter } from './homeassistant/index.mjs';

// Device adapters
export { TVControlAdapter } from './tv/index.mjs';
export { KioskAdapter } from './kiosk/index.mjs';
export { TaskerAdapter } from './tasker/index.mjs';
export { RemoteExecAdapter } from './remote-exec/index.mjs';

// Re-export port utilities for convenience
export {
  isHomeAutomationGateway,
  assertHomeAutomationGateway,
  createNoOpGateway
} from '../../1_domains/home-automation/index.mjs';
