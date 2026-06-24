import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const FitnessScreenContext = createContext(null);

/**
 * FitnessScreenProvider - Bridges screen-framework widgets to FitnessApp actions.
 *
 * @param {Function} props.onPlay - Add item to fitness play queue
 * @param {Function} props.onNavigate - Navigate to show/module/menu
 * @param {Function} props.onCtaAction - Handle coach CTA actions
 * @param {string|null} props.initialSelectedSessionId - Session to pre-select (e.g. post-session redirect)
 * @param {Function} props.onSelectedSessionConsumed - Called once the initial selection has been applied
 */
export function FitnessScreenProvider({
  onPlay,
  onNavigate,
  onCtaAction,
  initialSelectedSessionId = null,
  onSelectedSessionConsumed,
  roster = [],
  householdLabel = '',
  children,
}) {
  const [scrollToDate, setScrollToDate] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSelectedSessionId);
  const [longitudinalSelection, setLongitudinalSelection] = useState(null);
  const [lastPlayedContentId, setLastPlayedContentId] = useState(null);

  // Apply an externally-provided selection (post-session redirect) even when the
  // provider is already mounted, then notify the parent so it can clear the pending value.
  useEffect(() => {
    if (initialSelectedSessionId) {
      setSelectedSessionId(initialSelectedSessionId);
      onSelectedSessionConsumed?.();
    }
    // Only react to initialSelectedSessionId churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedSessionId]);

  const value = useMemo(() => ({
    onPlay, onNavigate, onCtaAction,
    scrollToDate, setScrollToDate,
    selectedSessionId, setSelectedSessionId,
    longitudinalSelection, setLongitudinalSelection,
    lastPlayedContentId, setLastPlayedContentId,
    roster, householdLabel,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate, selectedSessionId, longitudinalSelection, lastPlayedContentId, roster, householdLabel]);

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
      roster: [], householdLabel: '',
    };
  }
  return ctx;
}
