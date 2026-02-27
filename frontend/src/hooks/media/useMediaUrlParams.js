import { useMemo } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';

const MEDIA_ACTIONS = ['play', 'queue'];

/**
 * Parse URL params for MediaApp autoplay commands.
 * Supports: ?play=contentId, ?queue=contentId, and alias shorthand (?hymn=198).
 * Config modifiers: ?volume=, ?shuffle=, ?shader=
 */
export function useMediaUrlParams() {
  const command = useMemo(
    () => parseAutoplayParams(window.location.search, MEDIA_ACTIONS),
    []
  );

  return command;
}

export default useMediaUrlParams;
