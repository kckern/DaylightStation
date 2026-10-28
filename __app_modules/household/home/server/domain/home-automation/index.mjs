/**
 * Home Automation Domain
 * @module home-automation
 *
 * Provider-agnostic home automation abstractions.
 */

export { EntityCatalogPolicy, ENTITY_TYPES } from './EntityCatalogPolicy.mjs';
export { HomeEntity, STATE_CLASSES, stateClassOf } from './HomeEntity.mjs';
export { resolveRoom, buildRoomPrefixes } from './resolveRoom.mjs';
export { HouseSummaryPolicy, summarizeHouse } from './HouseSummary.mjs';
export { TimelinePolicy, buildLaneDay, LANE_KINDS } from './TimelinePolicy.mjs';
export { MosaicPolicy, arrangeMosaic, mergeShadows } from './MosaicPolicy.mjs';
export {
  dayWindows, localMidnight, bucketLine, toIntervals, risingEdges, sumIntervalsMs,
  dailyCounterTotal, counterDelta, integrateKwh, hasKnownValue,
} from './historySeries.mjs';
