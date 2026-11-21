import { Text } from '@mantine/core';
import { ErrorState, useFocusRegion } from '../../../lib/ui/index.js';

export function useApprovalRegion(approval, action) {
  const active = approval.action === action;
  const { regionProps, focus } = useFocusRegion(active && approval.busy);
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
