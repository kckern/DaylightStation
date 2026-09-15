// The STOP receipt belongs to the local session, not to a particular player
// view. Keeping the observer at the shell means a Mini Stop remains visible
// after navigating away from (or back to) Now Playing.
import React, { createContext, useContext } from 'react';
import { useSessionController } from '../controller/useSessionController.js';
import { useLocalStopFeedback } from './useLocalStopFeedback.js';

const LocalStopFeedbackContext = createContext(null);

export function LocalStopFeedbackProvider({ children }) {
  const { controller, snapshot } = useSessionController('local');
  const queueKeptCount = useLocalStopFeedback(controller, snapshot);
  return (
    <LocalStopFeedbackContext.Provider value={queueKeptCount}>
      {children}
    </LocalStopFeedbackContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook is the provider's public consumer seam
export function useLocalStopFeedbackCount() {
  return useContext(LocalStopFeedbackContext);
}

export default LocalStopFeedbackProvider;
