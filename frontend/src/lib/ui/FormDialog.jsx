import { Modal } from '@mantine/core';
import { useKeyboardViewport } from './useKeyboardViewport.js';
import './ds.scss';

/** A Mantine dialog whose editable form can scroll above the soft keyboard. */
export function FormDialog({ opened, ...props }) {
  const dialogRef = useKeyboardViewport(opened);
  return <Modal {...props} opened={opened} ref={dialogRef} />;
}
