import React from 'react';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

/**
 * Show a transient toast with an Undo action (audit C4). Used for
 * curation-flow deletes where a confirm dialog would be too heavy: the
 * action happens immediately and the user has `timeoutMs` to undo it.
 * Pass a stable `id` so repeated deletes replace rather than stack.
 */
export function showUndoToast({ id, title, message, onUndo, timeoutMs = 7000 }) {
  const notifId = id ?? 'undo-toast';
  notifications.show({
    id: notifId,
    title,
    color: 'gray',
    autoClose: timeoutMs,
    withCloseButton: true,
    message: React.createElement(
      Group,
      { justify: 'space-between', gap: 'sm', wrap: 'nowrap' },
      React.createElement(Text, { size: 'sm' }, message),
      React.createElement(
        Button,
        {
          size: 'xs',
          variant: 'subtle',
          'data-testid': 'undo-toast-button',
          onClick: () => {
            notifications.hide?.(notifId);
            onUndo?.();
          },
        },
        'Undo'
      )
    ),
  });
}

export function notifySuccess({ title, message }) {
  notifications.show({
    title,
    message: message ?? '',
    color: 'green',
    autoClose: 3000,
  });
}

export function notifyWarning({ title, message }) {
  notifications.show({
    title,
    message: message ?? '',
    color: 'yellow',
    autoClose: 7000,
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
