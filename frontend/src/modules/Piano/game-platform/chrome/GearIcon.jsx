/**
 * Settings, as a drawn gear.
 *
 * Inline SVG, never a unicode glyph — the kiosk WebView renders those as tofu,
 * which is a lesson this codebase learned twice (see the captured-piece row in
 * chess). Shared because three games now open a settings sheet and three copies
 * of one gear is how a kit stops being a kit.
 */
export default function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
      />
      <path
        fill="currentColor"
        d="m19.4 13-.2-1 1.7-1.3-1.7-3-2 .7-1-.6-.3-2.1h-3.8l-.3 2.1-1 .6-2-.7-1.7 3L8.8 12l-.2 1-1.7 1.3 1.7 3 2-.7 1 .6.3 2.1h3.8l.3-2.1 1-.6 2 .7 1.7-3L19.2 13Z"
        opacity="0.55"
      />
    </svg>
  );
}
