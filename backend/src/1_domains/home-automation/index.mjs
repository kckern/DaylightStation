/**
 * Home Automation Domain
 * @module home-automation
 *
 * Provider-agnostic home automation abstractions.
 */

export {
  isHomeAutomationGateway,
  assertHomeAutomationGateway,
  createNoOpGateway
} from './ports/IHomeAutomationGateway.mjs';
