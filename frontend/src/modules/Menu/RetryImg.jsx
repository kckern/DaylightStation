import React, { useState } from 'react';

export function RetryImg({
  src,
  alt,
  className,
  maxRetries = 2,
  fallback = null,
  onLoad,
  onError,
}) {
  const [attempt, setAttempt] = useState(0);
  const [givenUp, setGivenUp] = useState(false);

  if (givenUp || !src) return fallback;

  const url = attempt === 0
    ? src
    : `${src}${src.includes('?') ? '&' : '?'}_r=${attempt}`;

  return (
    <img
      key={attempt}
      src={url}
      alt={alt}
      className={className}
      onLoad={onLoad}
      onError={() => {
        if (attempt >= maxRetries) {
          setGivenUp(true);
          onError?.();
          return;
        }
        const delay = 600 * Math.pow(2, attempt);
        setTimeout(() => setAttempt(a => a + 1), delay);
      }}
    />
  );
}

export default RetryImg;
