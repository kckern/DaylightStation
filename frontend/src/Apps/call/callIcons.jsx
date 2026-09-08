import React from 'react';

/**
 * Chrome icons for the call surface, as inline SVG.
 *
 * Inline, not a font or a unicode glyph: the call app also has to render on a
 * kiosk WebView, where an unsupported codepoint silently becomes a tofu box
 * and the affordance disappears rather than degrading. `currentColor` lets one
 * glyph serve the green call action and the red exit without a second asset.
 *
 * The DEVICE icon is a different thing — it comes from `icon:` in devices.yml,
 * is chosen per device by whoever added it, and is rendered as declared.
 */
const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true, focusable: false,
};

/** Handset. Marks the action that places a call. */
export const PhoneIcon = ({ size = 22 }) => (
  <svg {...base} width={size} height={size}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);

/** Power. Marks leaving the call screen entirely. */
export const PowerIcon = ({ size = 20 }) => (
  <svg {...base} width={size} height={size}>
    <path d="M12 2v10" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </svg>
);

/** Handset down. Marks ending a call in progress. */
export const HangupIcon = ({ size = 22 }) => (
  <svg {...base} width={size} height={size}>
    <path d="M2.5 15.3l1.8-1.8a2 2 0 0 0 .5-2 9.6 9.6 0 0 1-.4-2 1.7 1.7 0 0 1 .6-1.4 12.6 12.6 0 0 1 14 0 1.7 1.7 0 0 1 .6 1.4c0 .7-.2 1.4-.4 2a2 2 0 0 0 .5 2l1.8 1.8" />
    <path d="M2 22 22 2" />
  </svg>
);

/** Microphone, struck through when muted. */
export const MicIcon = ({ size = 22, off = false }) => (
  <svg {...base} width={size} height={size}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v4" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);

/** Camera, struck through when off. */
export const CameraIcon = ({ size = 22, off = false }) => (
  <svg {...base} width={size} height={size}>
    <rect x="2" y="6" width="13" height="12" rx="2" />
    <path d="M15 11l7-4v10l-7-4" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);
