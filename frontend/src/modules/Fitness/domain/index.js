/**
 * Fitness Domain Module
 * 
 * Central export for fitness domain types and utilities.
 * Import from here to use domain models throughout the fitness module.
 * 
 * @example
 * import { ParticipantStatus, isDropout, createChartSegment } from '../domain';
 * import { ActivityMonitor } from '../domain';
 * import { ChartDataBuilder } from '../domain';
 */

export {
  // Enums/Constants
  ParticipantStatus,
  SegmentStyle,
  ZoneColors,
  
  // Type guards / predicates
  isInSession,
  isBroadcasting,
  isDropout,
  
  // Factory functions
  createActivityPeriod,
  createChartSegment,
  createParticipantSummary,
  
  // Utilities
  getSegmentStyle,
  getZoneColor
} from './types.js';

export { 
  ActivityMonitor, 
  createActivityMonitor 
} from './ActivityMonitor.js';

export {
  ChartDataBuilder,
  createChartDataBuilder
} from './ChartDataBuilder.js';
