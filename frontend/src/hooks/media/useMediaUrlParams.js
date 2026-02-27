import { useMemo } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';

const MEDIA_ACTIONS = ['play', 'queue'];

/**
 * Parse URL params for MediaApp autoplay commands.
 * Supports: ?play=contentId, ?queue=contentId, and alias shorthand (?hymn=198).
 * Config modifiers: ?volume=, ?shuffle=, ?shader=
 * Device targeting: ?device=deviceId (cast to remote device instead of local play)
 */
export function useMediaUrlParams() {
  const command = useMemo(
    () => parseAutoplayParams(window.location.search, MEDIA_ACTIONS),
    []
  );

  const device = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('device') || null;
  }, []);

  if (!command && !device) return null;
  return { ...command, device };
}

export default useMediaUrlParams;
