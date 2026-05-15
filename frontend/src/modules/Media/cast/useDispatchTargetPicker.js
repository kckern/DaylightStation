import { useCallback, useState } from 'react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { useCastTarget } from './useCastTarget.js';

export function useDispatchTargetPicker({ source, onComplete } = {}) {
  const fleet = useFleetContext();
  const { dispatchToTarget } = useDispatch();
  const { targetIds: defaultTargets, mode: defaultMode } = useCastTarget();
  const [selected, setSelected] = useState(() => new Set(defaultTargets));
  const [mode, setMode] = useState(defaultMode ?? 'transfer');

  const devices = Object.values(fleet.devices ?? {});

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const canSubmit = selected.size > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const targetIds = Array.from(selected);
    const params = { targetIds, mode };
    if (source?.play) params.play = source.play;
    if (source?.queue) params.queue = source.queue;
    if (source?.snapshot) params.snapshot = source.snapshot;
    dispatchToTarget(params);
    onComplete?.({ targetIds, mode });
  }, [canSubmit, selected, mode, source, dispatchToTarget, onComplete]);

  return {
    devices,
    selected,
    mode,
    canSubmit,
    toggle,
    setMode,
    submit,
  };
}

export default useDispatchTargetPicker;
