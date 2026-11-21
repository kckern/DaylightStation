import { Button as MantineButton, Loader } from '@mantine/core';
import { Button } from './Button.jsx';

/** Keep the submit control focused while its command or confirmation is pending. */
export function SubmitButton({ as: Control = Button, pending, blocked, disabled, type = 'submit', leftSection, onClick, ...props }) {
  const unavailable = pending || blocked;
  const visualProps = Control === MantineButton
    ? { 'data-disabled': unavailable || undefined, leftSection: pending ? <Loader size="xs" aria-hidden="true" /> : leftSection }
    : {};
  return (
    <Control
      {...props}
      {...visualProps}
      type={type}
      disabled={disabled && !pending}
      aria-disabled={unavailable || undefined}
      aria-busy={pending || undefined}
      onClick={event => {
        if (unavailable) event.preventDefault();
        else onClick?.(event);
      }}
    />
  );
}
