import { useState } from 'react';
import { Switch, Text } from '@mantine/core';

export function EntitySwitch({ entity, onToggle, size }) {
  const checked = entity.stateClass === 'on';
  const pending = Boolean(entity.pending);
  const [failure, setFailure] = useState(null);
  const failureMessage = failure?.entityId === entity.id ? failure.message : null;

  return (
    <div className="home-entity-switch">
      <Switch
        checked={checked}
        size={size}
        aria-label={`${entity.name}: turn ${checked ? 'off' : 'on'}`}
        aria-disabled={pending || undefined}
        data-disabled={pending || undefined}
        onClick={event => {
          // Keep the switch focusable without allowing another native toggle.
          if (pending) event.preventDefault();
        }}
        onChange={async () => {
          if (pending) return;
          setFailure(null);
          const action = checked ? 'turn off' : 'turn on';
          const succeeded = await onToggle?.(entity);
          if (succeeded === false) {
            setFailure({ entityId: entity.id, message: `Couldn't ${action} ${entity.name}. Try again.` });
          }
        }}
      />
      {failureMessage && <Text size="xs" className="home-entity-switch__error" role="alert">{failureMessage}</Text>}
    </div>
  );
}
