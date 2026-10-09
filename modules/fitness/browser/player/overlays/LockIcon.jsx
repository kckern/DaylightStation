// Solid padlock glyph for the in-player Skip/Unlock affordance. Stands in for the
// requested svgrepo 513445 lock (a filled black padlock) rendered WHITE: the path is
// drawn with `currentColor`, so the consumer sets the color (white on the dark
// governance panel). Sized in `em` so it scales with the button's font-size, matching
// the FingerprintIcon convention in widgets/FingerprintManager.
import React from 'react';

export default function LockIcon({ size = '1em', ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
    </svg>
  );
}
