// frontend/src/modules/Media/shell/EndOfQueueChoice.jsx
// What happens when the queue ends — stop, repeat, or keep similar things
// playing — ONE compact segmented control under the queue showing the current
// choice (STEER.13a, RQ-STEER-19; Now Playing ruling 2026-11-27). The same for
// this device and another screen.
import React, { useContext, useId, useState } from 'react';
import { Text } from '@mantine/core';
import { useSessionControls } from "../controller/useSessionControls.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import mediaLog from "../logging/mediaLog.js";
import { MediaRadioOption } from '../shared/MediaRadioOption.jsx';
import "./SessionControls.scss";

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
  const radioName = `queue-end-${useId()}`;
  const current = controls?.endOfQueue ?? 'stop';
  const targetId = kind === 'local' ? 'local' : target?.deviceId ?? null;
  const disabled = !available || !actions;

  const choose = async (mode) => {
    if (disabled || mode === current || pending) return;
    setPending(mode);
    mediaLog.nowPlayingEndActionChanged({ target: targetId, from: current, to: mode });
    if (kind !== 'local') mediaLog.sessionControlCommand({ target: targetId, action: 'setEndOfQueue', value: mode });
    let result;
    try { result = await actions.setEndOfQueue(mode); } catch (error) { result = { ok: false, error: error?.message }; }
    setPending(null);
    if (result?.ok === false) {
      if (kind !== 'local') mediaLog.sessionControlFailed({ target: targetId, action: 'setEndOfQueue', code: result.code ?? null, error: result.error ?? null });
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
      <div className="queue-end-row">
      <Text size="sm" className="queue-end-label" id={`queue-end-label-${targetId}`}>When the queue ends</Text>
      <div className="queue-end-options queue-end-segmented" role="radiogroup" aria-labelledby={`queue-end-label-${targetId}`}>
        {END_OF_QUEUE_CHOICES.map((choice) => (
          <MediaRadioOption
            key={choice.value}
            name={radioName}
            value={choice.value}
            checked={current === choice.value}
            testId={`queue-end-${choice.value}`}
            className="queue-end-option"
            contentClassName="queue-end-option__content"
            disabled={disabled || pending != null}
            onChange={choose}
          >
            {choice.label}
          </MediaRadioOption>
        ))}
      </div>
      </div>
      {status && <Text size="xs" className="queue-end-status" data-testid="queue-end-status" role="status">{status}</Text>}
      {disabled && reason && <Text size="xs" className="queue-end-status" data-testid="queue-end-unavailable">{reason}</Text>}
    </div>
  );
}

export default EndOfQueueChoice;
