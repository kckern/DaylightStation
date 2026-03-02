import React, { createContext, useContext, useMemo } from 'react';

const FitnessScreenContext = createContext(null);

/**
 * FitnessScreenProvider - Bridges screen-framework widgets to FitnessApp actions.
 *
 * @param {Function} props.onPlay - Add item to fitness play queue
 * @param {Function} props.onNavigate - Navigate to show/module/menu
 * @param {Function} props.onCtaAction - Handle coach CTA actions
 */
export function FitnessScreenProvider({ onPlay, onNavigate, onCtaAction, children }) {
  const value = useMemo(() => ({ onPlay, onNavigate, onCtaAction }), [onPlay, onNavigate, onCtaAction]);
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
    return { onPlay: null, onNavigate: null, onCtaAction: null };
  }
  return ctx;
}
