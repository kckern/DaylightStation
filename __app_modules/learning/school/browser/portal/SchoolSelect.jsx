import { forwardRef } from 'react';
import { Select } from '#frontend/lib/ui/Select.jsx';
import { useSchoolSurface } from './SchoolSurface.jsx';

export const SchoolSelect = forwardRef(function SchoolSelect({ density, ...props }, ref) {
  const surface = useSchoolSurface();
  return <Select {...props} density={density ?? surface.density} ref={ref} />;
});
export default SchoolSelect;
