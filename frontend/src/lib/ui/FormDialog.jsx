import { Modal } from '@mantine/core';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import { useKeyboardViewport } from './useKeyboardViewport.js';
import './ds.scss';

/** A Mantine dialog whose editable form can scroll above the soft keyboard. */
export function FormDialog({ opened, onClose, closeOnEscape = true, ...props }) {
  const dialogRef = useKeyboardViewport(opened);
  const usesDismissStack = useDismissLayer(opened, onClose, { managed: !closeOnEscape });
  return (
    <Modal
      {...props}
      opened={opened}
      onClose={onClose}
      closeOnEscape={!usesDismissStack && closeOnEscape}
      ref={dialogRef}
    />
  );
}
