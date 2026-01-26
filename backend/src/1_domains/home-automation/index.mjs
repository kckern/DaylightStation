/**
 * Home Automation Domain
 * @module home-automation
 *
 * Provider-agnostic home automation abstractions.
 */

// Ports moved to application layer - re-export for backward compatibility
export {
  isHomeAutomationGateway,
  assertHomeAutomationGateway,
  createNoOpGateway
} from '../../3_applications/home-automation/ports/IHomeAutomationGateway.mjs';
