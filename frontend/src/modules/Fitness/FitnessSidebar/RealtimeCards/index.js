/**
 * RealtimeCards Registry
 * 
 * Maps device types to their corresponding card components.
 * Use getCardComponent(device.type) to get the right renderer.
 */

import { PersonCard } from './PersonCard.jsx';
import { CadenceCard } from './CadenceCard.jsx';
import { JumpropeCard } from './JumpropeCard.jsx';
import { VibrationCard } from './VibrationCard.jsx';
import { BaseRealtimeCard, StatsRow } from './BaseRealtimeCard.jsx';

/**
 * Registry mapping device type to card component
 */
const CARD_REGISTRY = {
  // People (heart rate monitors)
  heart_rate: PersonCard,
  
  // Equipment - Cadence-based
  cadence: CadenceCard,
  stationary_bike: CadenceCard,
  ab_roller: CadenceCard,
  
  // Equipment - BLE
  jumprope: JumpropeCard,
  
  // Equipment - Vibration-based
  vibration: VibrationCard,
  punching_bag: VibrationCard,
  step_platform: VibrationCard,
  pull_up_bar: VibrationCard,
};

/**
 * Get the card component for a device type
 * @param {string} deviceType - The device.type value
 * @returns {React.Component} The card component to render
 */
export function getCardComponent(deviceType) {
  return CARD_REGISTRY[deviceType] || null;
}

/**
 * Check if a device type has a registered card
 * @param {string} deviceType
 * @returns {boolean}
 */
export function hasCard(deviceType) {
  return deviceType in CARD_REGISTRY;
}

/**
 * Get all registered device types
 * @returns {string[]}
 */
export function getRegisteredTypes() {
  return Object.keys(CARD_REGISTRY);
}

/**
 * Register a custom card component for a device type
 * @param {string} deviceType
 * @param {React.Component} component
 */
export function registerCard(deviceType, component) {
  CARD_REGISTRY[deviceType] = component;
}

// Named exports for direct imports
export {
  PersonCard,
  CadenceCard,
  JumpropeCard,
  VibrationCard,
  BaseRealtimeCard,
  StatsRow
};

export default {
  getCardComponent,
  hasCard,
  getRegisteredTypes,
  registerCard,
  PersonCard,
  CadenceCard,
  JumpropeCard,
  VibrationCard,
  BaseRealtimeCard,
  StatsRow
};
