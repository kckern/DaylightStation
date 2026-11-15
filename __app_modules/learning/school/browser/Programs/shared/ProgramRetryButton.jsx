import { TouchButton } from '../../../../../../frontend/src/lib/ui/index.js';
import { useProgramKeys } from './useProgramKeys.js';
export default function ProgramRetryButton({ onRetry }) {
  useProgramKeys({ enter: onRetry });
  return <div className="reflection-controls"><TouchButton variant="primary" keyHint="Enter" onClick={onRetry}>Try again</TouchButton></div>;
}
