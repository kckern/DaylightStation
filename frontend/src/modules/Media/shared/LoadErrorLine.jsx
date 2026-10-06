import React from 'react';
import { Button } from '@mantine/core';
import { loadErrorMessage, LOAD_ERROR_RETRY_LABEL } from './loadErrorCopy.js';

// A failed row/list/search: one quiet line and a normal-size secondary
// button, in the place the content would have been. Never the error text.
export function LoadErrorLine({ kind = 'section', error = null, onRetry, testId, retryTestId, className = '' }) {
  return (
    <div className={`media-load-error ${className}`.trim()} role="alert" data-testid={testId}>
      <span className="media-load-error__text">{loadErrorMessage(kind, error)}</span>
      {typeof onRetry === 'function' && (
        <Button variant="default" size="md" className="media-load-error__retry"
          data-testid={retryTestId} onClick={onRetry}>
          {LOAD_ERROR_RETRY_LABEL}
        </Button>
      )}
    </div>
  );
}

export default LoadErrorLine;
