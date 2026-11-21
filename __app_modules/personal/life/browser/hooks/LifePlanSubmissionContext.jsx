import { createContext, useContext } from 'react';
import { useKeyedSubmission } from '../../../../../frontend/src/lib/ui/useKeyedSubmission.js';

const LifePlanSubmissionContext = createContext(null);

export function LifePlanSubmissionProvider({ children }) {
  const submission = useKeyedSubmission();
  return (
    <LifePlanSubmissionContext.Provider value={submission}>
      {children}
    </LifePlanSubmissionContext.Provider>
  );
}

export function useLifePlanSubmission() {
  const submission = useContext(LifePlanSubmissionContext);
  if (!submission) throw new Error('useLifePlanSubmission must be used within LifePlanSubmissionProvider');
  return submission;
}
