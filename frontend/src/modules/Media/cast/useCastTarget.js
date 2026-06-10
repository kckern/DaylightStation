import { useContext } from 'react';
import { CastTargetContext } from './CastTargetProvider.jsx';

export function useCastTarget() {
  const ctx = useContext(CastTargetContext);
  if (!ctx) throw new Error('useCastTarget must be used inside CastTargetProvider');
  return ctx;
}

export default useCastTarget;
