/**
 * The chip a list row shows when its action asks for something its content
 * cannot do — and the one click that fixes it.
 *
 * Concretely: `input: files:art/fhe/esther.jpg` + `action: Display`. The
 * `files` source reports an image as `playable`, not `displayable`, so the
 * screen rendered an empty frame with no error anywhere. The same file as
 * `canvas:fhe/esther.jpg` is displayable, so the fix is a swap, not a rewrite.
 *
 * Renders nothing unless there is something certain to say — see the quietness
 * rules in useActionCapabilityCheck.
 */
import { Button, Group, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useActionCapabilityCheck } from './useActionCapabilityCheck.js';

/**
 * @param {Object} props
 * @param {string} props.input - the row's content id
 * @param {string} props.action - the row's action
 * @param {(patch: Object) => void} props.onUpdate - row patch callback
 */
export function CapabilityWarning({ input, action, onUpdate }) {
  const { mismatch, suggestion, loading } = useActionCapabilityCheck(input, action);

  if (loading || !mismatch) return null;

  const needs = mismatch.accepts.join(' or ');

  return (
    <Group gap={6} wrap="nowrap" role="alert" className="capability-warning">
      <IconAlertTriangle size={14} color="var(--mantine-color-yellow-6)" />
      <Text size="xs" c="yellow.7">
        {`${mismatch.action} needs a ${needs} source — this one isn't.`}
      </Text>
      {suggestion && (
        <Button
          size="compact-xs"
          variant="light"
          color="yellow"
          onClick={() => onUpdate({ input: suggestion })}
        >
          {`Use ${suggestion}`}
        </Button>
      )}
    </Group>
  );
}

export default CapabilityWarning;
