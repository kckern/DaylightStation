import { TouchButton } from "../../../../../../frontend/src/lib/ui/index.js";
import { useSchoolDebriefKeys } from "./useSchoolDebriefKeys.js";

/** A failed step is never a dead end: Enter (or a tap) runs it again. */
export default function RetryButton({ onRetry }) {
  useSchoolDebriefKeys({ enter: onRetry });
  return (
    <div className="sd-controls">
      <TouchButton variant="primary" keyHint="Enter" onClick={onRetry}>Try again</TouchButton>
    </div>
  );
}
