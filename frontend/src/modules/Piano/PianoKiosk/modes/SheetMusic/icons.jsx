/**
 * icons — inline SVG icons for the sheet-music chrome. Pictorial button content
 * is ALWAYS one of these components, never a text glyph or emoji (KC directive):
 * icons inherit the button's color (currentColor), scale with font size, and are
 * decorative (aria-hidden) — the button's aria-label carries the accessible name.
 */
const Icon = ({ children, ...rest }) => (
  <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
    {children}
  </svg>
);

export const PlayIcon = () => <Icon><path d="M8 5v14l11-7z" /></Icon>;
export const PauseIcon = () => <Icon><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></Icon>;
export const RestartIcon = () => (
  <Icon><path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /></Icon>
);
export const QuarterNoteIcon = () => (
  <Icon><path d="M14.5 3H16v13.5a3.5 3.5 0 1 1-1.5-2.88z" /></Icon>
);
export const CloseIcon = () => (
  <Icon><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></Icon>
);
export const ChevronDownIcon = () => (
  <Icon><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" /></Icon>
);
