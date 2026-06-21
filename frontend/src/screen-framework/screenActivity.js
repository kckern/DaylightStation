// Single source of truth for "is the screen showing active content?"
// Used by ScreenScreensaver (suppress while content is up) and the presence
// publisher (drive input_boolean.office_tv_active).
//
// Browse surfaces — an idle one of these is when the screensaver SHOULD fire and
// when the TV is NOT "active". Anything else on the nav stack (player, app,
// display, launch, android-launch, future content types) is active content.
// Default-active for unknown types is the safe bias.
export const BROWSE_NAV_TYPES = new Set(['menu', 'plex-menu', 'show-view', 'season-view']);

/**
 * @param {{type?: string}|null} currentContent - top of the MenuNavigation stack
 * @param {boolean} hasOverlay - a fullscreen overlay is mounted
 * @returns {boolean}
 */
export function isContentActive(currentContent, hasOverlay) {
  if (hasOverlay) return true;
  return !!currentContent && !BROWSE_NAV_TYPES.has(currentContent.type);
}
