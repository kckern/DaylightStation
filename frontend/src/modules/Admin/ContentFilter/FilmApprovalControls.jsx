import { Text } from '@mantine/core';
import { ErrorState, useFocusRegion } from '../../../lib/ui/index.js';

// `outer` is a focus region owned by a parent that outlives the control (the Approve panel swaps
// the Approve button for Withdraw), so focus has one stable destination through the swap.
export function useApprovalRegion(approval, action, outer = null) {
  const active = approval.action === action;
  const own = useFocusRegion(active && approval.busy);
  const regionProps = outer ? {} : own.regionProps;
  const focus = outer ? outer.focus : own.focus;
  return {
    regionProps,
    feedback: active ? approval : null,
    start: () => {
      focus();
      approval.submit(action);
    },
    retry: () => {
      focus();
      approval.retry();
    },
  };
}

export function ApprovalFeedback({ feedback, onRetry }) {
  if (feedback?.readError) return <ErrorState error={feedback.readError} onRetry={onRetry} label="Film review" />;
  return feedback?.notice ? <Text size="sm" role="status">{feedback.notice}</Text> : null;
}
