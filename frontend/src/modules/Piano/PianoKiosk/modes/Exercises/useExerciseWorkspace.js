import { useCallback, useEffect, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { pianoLearningApi } from './pianoLearningApi.js';

export function useExerciseWorkspace(userId) {
  const [state, setState] = useState({ catalog: null, learning: null, error: null, loading: true });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([pianoLearningApi.catalog(), pianoLearningApi.learning(userId || 'guest')]).then(([catalog, learning]) => {
      if (!alive) return;
      if (!catalog.ok || !learning.ok) {
        setState({ catalog: catalog.data, learning: learning.data, loading: false, error: 'The exercise workspace could not be loaded.' });
        return;
      }
      setState({ catalog: catalog.data, learning: learning.data, loading: false, error: null });
    }).catch((error) => {
      if (!alive) return;
      getLogger().child({ component: 'piano-exercises' }).warn('piano.exercises.workspace-failed', { error: error.message });
      setState((current) => ({ ...current, loading: false, error: 'The exercise workspace could not be loaded.' }));
    });
    return () => { alive = false; };
  }, [userId, revision]);

  return { ...state, refresh };
}

export default useExerciseWorkspace;
