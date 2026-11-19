import { Switch } from '@mantine/core';

export function EntitySwitch({ entity, onToggle, size }) {
  const checked = entity.stateClass === 'on';
  const pending = Boolean(entity.pending);

  return (
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
      onChange={() => {
        if (!pending) onToggle?.(entity);
      }}
    />
  );
}
