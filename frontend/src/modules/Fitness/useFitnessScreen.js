// useFitnessScreen.js — the widget-facing accessor for FitnessScreenProvider.jsx,
// split out so Fast Refresh can hot-reload files that only export components.
import { useContext } from 'react';
import { FitnessScreenContext } from './FitnessScreenProvider.jsx';

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
      roster: [], householdLabel: '', compareWeeks: 4, zoneRingRates: null,
    };
  }
  return ctx;
}
