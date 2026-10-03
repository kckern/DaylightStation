// frontend/src/modules/Media/shell/EndOfQueueChoice.jsx
// What happens when the queue ends — stop, repeat, or keep similar things
// playing — shown at the bottom of the queue with the current choice
// (STEER.13a, RQ-STEER-19). The same for this device and another screen.
import React, { useContext, useState } from 'react';
import { Button, Text } from '@mantine/core';
import { useSessionControls } from '../controller/useSessionControls.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import mediaLog from '../logging/mediaLog.js';
import './SessionControls.scss';

export const END_OF_QUEUE_CHOICES = [
  { value: 'stop', label: 'Stop' },
  { value: 'repeat', label: 'Repeat the queue' },
  { value: 'similar', label: 'Keep similar playing' },
];

export function endOfQueueStatusText(status) {
  if (!status) return null;
  if (status.code === 'NOTHING_SIMILAR') return status.message ?? 'Nothing similar left';
  if (status.code === 'SIMILAR_ADDED') {
    const n = status.count ?? 0;
    return `Added ${n} similar item${n === 1 ? '' : 's'}${status.title ? `, starting with ${status.title}` : ''}`;
  }
  if (status.code === 'STOPPED_AFTER_CURRENT') return 'Stopped after that one, as asked';
  return null;
}

export function EndOfQueueChoice({ target, targetName = null }) {
  const { kind, controls, actions, available, reason } = useSessionControls(target);
  const outcomes = useContext(DispatchContext);
  const [pending, setPending] = useState(null);
  const current = controls?.endOfQueue ?? 'stop';
  const targetId = kind === 'local' ? 'local' : target?.deviceId ?? null;
  const disabled = !available || !actions;

  const choose = async (mode) => {
    if (disabled || mode === current || pending) return;
    setPending(mode);
    mediaLog.sessionControlCommand({ target: targetId, action: 'setEndOfQueue', value: mode });
    let result;
    try { result = await actions.setEndOfQueue(mode); } catch (error) { result = { ok: false, error: error?.message }; }
    setPending(null);
    if (result?.ok === false) {
      mediaLog.sessionControlFailed({ target: targetId, action: 'setEndOfQueue', code: result.code ?? null, error: result.error ?? null });
      outcomes?.recordLocal?.({
        kind: 'control', phase: 'failed', item: { title: 'what happens when the queue ends' },
        reason: result.error ?? result.code ?? 'The screen did not confirm the change',
        targetId, targetName: kind === 'local' ? null : targetName,
      });
    }
  };

  const status = endOfQueueStatusText(controls?.endOfQueueStatus);
  return (
    <div className="queue-end-choice" data-testid="queue-end-choice">
      <Text size="sm" fw={600} id={`queue-end-label-${targetId}`}>When the queue ends</Text>
      <div className="queue-end-options" role="radiogroup" aria-labelledby={`queue-end-label-${targetId}`}>
        {END_OF_QUEUE_CHOICES.map((choice) => (
          <Button
            key={choice.value}
            role="radio"
            aria-checked={current === choice.value}
            data-testid={`queue-end-${choice.value}`}
            className="session-controls-btn"
            size="sm"
            variant={current === choice.value ? 'light' : 'default'}
            disabled={disabled || pending != null}
            onClick={() => choose(choice.value)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      {status && <Text size="xs" className="queue-end-status" data-testid="queue-end-status" role="status">{status}</Text>}
      {disabled && reason && <Text size="xs" className="queue-end-status" data-testid="queue-end-unavailable">{reason}</Text>}
    </div>
  );
}

export default EndOfQueueChoice;
