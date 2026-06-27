import { useState, useEffect } from 'react';
import { DaylightAPI } from './api.mjs';

export function useTempHook(id) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    DaylightAPI(id).then(() => setLoading(false)).catch(err => { setError(err.message); setLoading(false); });
  }, [id]);
  return { loading, error };
}
