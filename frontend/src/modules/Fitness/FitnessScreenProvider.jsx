import React, { createContext, useContext, useMemo, useState } from 'react';

const FitnessScreenContext = createContext(null);

/**
 * FitnessScreenProvider - Bridges screen-framework widgets to FitnessApp actions.
 *
 * @param {Function} props.onPlay - Add item to fitness play queue
 * @param {Function} props.onNavigate - Navigate to show/module/menu
 * @param {Function} props.onCtaAction - Handle coach CTA actions
 */
export function FitnessScreenProvider({ onPlay, onNavigate, onCtaAction, children }) {
  const [scrollToDate, setScrollToDate] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [longitudinalSelection, setLongitudinalSelection] = useState(null);
  const [lastPlayedContentId, setLastPlayedContentId] = useState(null);

  const value = useMemo(() => ({
    onPlay, onNavigate, onCtaAction,
    scrollToDate, setScrollToDate,
    selectedSessionId, setSelectedSessionId,
    longitudinalSelection, setLongitudinalSelection,
    lastPlayedContentId, setLastPlayedContentId,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate, selectedSessionId, longitudinalSelection, lastPlayedContentId]);

  return (
    <FitnessScreenContext.Provider value={value}>
      {children}
    </FitnessScreenContext.Provider>
  );
}

/**
 * useFitnessScreen - Access FitnessApp action callbacks from within a screen-framework widget.
 */
export function useFitnessScreen() {
  const ctx = useContext(FitnessScreenContext);
  if (!ctx) {
    return {
      onPlay: null, onNavigate: null, onCtaAction: null,
      scrollToDate: null, setScrollToDate: () => {},
      selectedSessionId: null, setSelectedSessionId: () => {},
      longitudinalSelection: null, setLongitudinalSelection: () => {},
      lastPlayedContentId: null, setLastPlayedContentId: () => {},
    };
  }
  return ctx;
}
