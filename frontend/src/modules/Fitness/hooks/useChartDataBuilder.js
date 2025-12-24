/**
 * useChartDataBuilder - React hook for ChartDataBuilder
 * 
 * Provides a memoized ChartDataBuilder instance configured with
 * the current session's timeline data and activity monitor.
 * 
 * @example
 * const { builder, getParticipantData, getAllParticipantsData } = useChartDataBuilder();
 * const data = getAllParticipantsData(participants);
 */

import { useMemo, useCallback } from 'react';
import { ChartDataBuilder } from '../domain/ChartDataBuilder.js';

/**
 * Hook to create and use a ChartDataBuilder instance
 * 
 * @param {Object} options
 * @param {Function} options.getSeries - Timeline series getter
 * @param {Object} options.timebase - Timeline timebase config
 * @param {import('../domain').ActivityMonitor} [options.activityMonitor] - Activity monitor
 * @returns {Object}
 */
export const useChartDataBuilder = ({ getSeries, timebase, activityMonitor } = {}) => {
  // Create memoized builder instance
  const builder = useMemo(() => {
    if (typeof getSeries !== 'function') return null;
    
    return new ChartDataBuilder({
      getSeries,
      timebase,
      activityMonitor
    });
  }, [getSeries, timebase, activityMonitor]);

  // Memoized convenience methods
  const getParticipantData = useCallback((participant) => {
    return builder?.getParticipantData(participant) ?? null;
  }, [builder]);

  const getAllParticipantsData = useCallback((participants) => {
    return builder?.getAllParticipantsData(participants) ?? [];
  }, [builder]);

  const getParticipantSegments = useCallback((participantId) => {
    return builder?.getParticipantSegments(participantId) ?? [];
  }, [builder]);

  const getAllSegments = useCallback((participants) => {
    return builder?.getAllSegments(participants) ?? new Map();
  }, [builder]);

  const createPaths = useCallback((segments, options) => {
    return builder?.createPaths(segments, options) ?? [];
  }, [builder]);

  const getParticipantPaths = useCallback((participant, pathOptions) => {
    return builder?.getParticipantPaths(participant, pathOptions) ?? { data: null, paths: [] };
  }, [builder]);

  return {
    // The builder instance for advanced usage
    builder,
    
    // Convenience methods (bound to current builder)
    getParticipantData,
    getAllParticipantsData,
    getParticipantSegments,
    getAllSegments,
    createPaths,
    getParticipantPaths,
    
    // Status
    isReady: builder !== null
  };
};

export default useChartDataBuilder;
