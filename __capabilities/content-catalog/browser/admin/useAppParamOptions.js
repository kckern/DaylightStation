import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveParamOptions } from '../../../../frontend/src/lib/appRegistry.js';

export function useAppParamOptions() {
  const [resolution, setResolution] = useState(null);
  const generation = useRef(0);
  const controller = useRef(null);
  const selectedApp = useRef(null);

  const clear = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    selectedApp.current = null;
    setResolution(null);
  }, []);

  const select = useCallback(async ({ appId, param }) => {
    generation.current++;
    const requestGeneration = generation.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    selectedApp.current = { appId, param };
    setResolution({ phase: 'loading', appId, param });

    try {
      const options = await resolveParamOptions(param, { signal: requestController.signal });
      if (generation.current === requestGeneration) {
        setResolution({
          phase: 'ready',
          appId,
          param,
          options: options ? [{ value: 'random', label: 'Random' }, ...options] : null,
        });
      }
    } catch (error) {
      if (generation.current === requestGeneration && error?.name !== 'AbortError') {
        setResolution({ phase: 'error', appId, param, error: error?.message || 'Options could not be loaded.' });
      }
    }
  }, []);

  const retry = useCallback(() => selectedApp.current ? select(selectedApp.current) : undefined, [select]);

  useEffect(() => () => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);

  return { resolution, select, retry, clear };
}
