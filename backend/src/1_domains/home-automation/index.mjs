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
} from '#apps/home-automation/ports/IHomeAutomationGateway.mjs';
