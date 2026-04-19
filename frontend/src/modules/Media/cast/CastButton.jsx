import React from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useDispatch } from './useDispatch.js';

export function CastButton({ contentId, queue, onAction }) {
  const { targetIds, mode } = useCastTarget();
  const { dispatchToTarget } = useDispatch();
  const id = contentId ?? queue;
  const disabled = targetIds.length === 0;

  const onClick = () => {
    if (disabled) return;
    const params = { targetIds, mode };
    if (contentId) params.play = contentId;
    else if (queue) params.queue = queue;
    dispatchToTarget(params);
    onAction?.();
  };

  return (
    <button
      data-testid={`cast-button-${id}`}
      className="cast-button"
      onClick={onClick}
      disabled={disabled}
    >
      Cast
    </button>
  );
}

export default CastButton;
