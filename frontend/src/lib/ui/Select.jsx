import { forwardRef } from 'react';
import './TouchButton.scss';

/** Token-driven native select; options, multiple, form, events and refs stay native. */
export const Select = forwardRef(function Select({ density = 'touch', className = '', ...props }, ref) {
  return <select {...props} ref={ref} data-density={density} className={`ds-select ${className}`.trim()} />;
});
export default Select;
