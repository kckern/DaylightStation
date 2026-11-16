import { forwardRef } from 'react';
import { Button } from '#frontend/lib/ui/Button.jsx';
import { useSchoolSurface } from './SchoolSurface.jsx';

export const SchoolButton = forwardRef(function SchoolButton({ density, ...props }, ref) {
  const surface = useSchoolSurface();
  return <Button {...props} density={density ?? surface.density} ref={ref} />;
});
export default SchoolButton;
