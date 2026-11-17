import { forwardRef } from 'react';
import { Button } from './Button.jsx';

/** Legacy kiosk adapter retains its always-button form behavior. */
export const TouchButton = forwardRef(function TouchButton(props, ref) {
  return <Button {...props} ref={ref} type="button" />;
});
export default TouchButton;
