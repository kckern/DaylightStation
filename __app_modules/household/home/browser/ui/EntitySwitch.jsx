import { useEffect, useState } from 'react';
import { Switch, Text } from '@mantine/core';

export function EntitySwitch({ entity, onToggle, size }) {
  const checked = entity.stateClass === 'on';
  const pending = Boolean(entity.pending);
  const [failure, setFailure] = useState(null);
  const confirmedFailure = failure?.entityId === entity.id && !pending && entity.stateClass === failure.target;
  const failureMessage = failure?.entityId === entity.id && !confirmedFailure ? failure.message : null;

  useEffect(() => {
    if (failure && (
      failure.entityId !== entity.id
      || (!pending && entity.stateClass === failure.target)
    )) {
      setFailure(null);
    }
  }, [entity.id, entity.stateClass, failure, pending]);

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
          const target = checked ? 'off' : 'on';
          const action = `turn ${target}`;
          const succeeded = await onToggle?.(entity);
          if (succeeded === false) {
            setFailure({ entityId: entity.id, target, message: `Couldn't ${action} ${entity.name}. Try again.` });
          }
        }}
      />
      {failureMessage && <Text size="xs" className="home-entity-switch__error" role="alert">{failureMessage}</Text>}
    </div>
  );
}
