// frontend/src/modules/Media/cast/useDispatchTargetPicker.js
// State for the dispatch target picker: device multi-select (seeded from the
// preferred cast target), transfer/fork mode, and submit. A `snapshot`
// source dispatches in adopt mode (hand-off); transfer-vs-fork still
// controls whether local stops on confirmed success.
import { useCallback, useState } from 'react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDispatch } from './DispatchProvider.jsx';
import { useCastTarget } from './useCastTarget.js';

export function useDispatchTargetPicker({ source, onComplete } = {}) {
  const fleet = useFleetContext();
  const { dispatchToTarget } = useDispatch();
  const { targetIds: defaultTargets, mode: defaultMode } = useCastTarget();
  const [selected, setSelected] = useState(() => new Set(defaultTargets));
  const [mode, setMode] = useState(defaultMode ?? 'transfer');

  const devices = fleet.devices ?? [];

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
    // Hand-off snapshots are captured AT SUBMIT so the position is current.
    const snapshot = source?.getSnapshot?.() ?? source?.snapshot;
    if (snapshot) params.snapshot = snapshot;
    else if (source?.play) params.play = source.play;
    else if (source?.queue) params.queue = source.queue;
    dispatchToTarget(params);
    onComplete?.({ targetIds, mode });
  }, [canSubmit, selected, mode, source, dispatchToTarget, onComplete]);

  return { devices, selected, mode, canSubmit, toggle, setMode, submit };
}

export default useDispatchTargetPicker;
