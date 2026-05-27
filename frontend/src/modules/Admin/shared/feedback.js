import { notifications } from '@mantine/notifications';

export function notifySuccess({ title, message }) {
  notifications.show({
    title,
    message: message ?? '',
    color: 'green',
    autoClose: 3000,
  });
}

export function notifyFailure({ title, message }) {
  notifications.show({
    title,
    message: message ?? 'An error occurred',
    color: 'red',
    autoClose: false,
  });
}

export function notifyPartial({ title, applied = [], skipped = [] }) {
  const lines = [];
  if (applied.length > 0) lines.push(`applied: ${applied.join(', ')}`);
  if (skipped.length > 0) {
    const skipDesc = skipped
      .map((s) => `${s.color}: ${s.reason}`)
      .join('; ');
    lines.push(`skipped: ${skipDesc}`);
  }
  notifications.show({
    title,
    message: lines.join(' · '),
    color: 'yellow',
    autoClose: 7000,
  });
}

export async function runWithFeedback(fn, opts = {}) {
  const {
    logger,
    eventName,
    successTitle,
    successMessage,
    partialTitle,
    partialFromResult,
    failureTitle,
    logContext = {},
  } = opts;

  if (!logger || !eventName) {
    throw new Error('runWithFeedback: logger and eventName are required');
  }

  logger.info(`${eventName}.started`, logContext);

  try {
    const result = await fn();
    const partial = partialFromResult ? partialFromResult(result) : null;
    if (partial?.isPartial) {
      logger.warn(`${eventName}.partial`, {
        ...logContext,
        applied: partial.applied,
        skipped: partial.skipped,
      });
      if (partialTitle) {
        notifyPartial({
          title: partialTitle,
          applied: partial.applied ?? [],
          skipped: partial.skipped ?? [],
        });
      }
    } else if (successTitle) {
      const msg = typeof successMessage === 'function'
        ? successMessage(result)
        : successMessage;
      logger.info(`${eventName}.success`, logContext);
      notifySuccess({ title: successTitle, message: msg });
    } else {
      logger.info(`${eventName}.success`, logContext);
    }
    return { ok: true, result };
  } catch (error) {
    logger.error(`${eventName}.failure`, {
      ...logContext,
      message: error?.message ?? String(error),
    });
    if (failureTitle) {
      notifyFailure({ title: failureTitle, message: error?.message ?? String(error) });
    }
    return { ok: false, error };
  }
}
