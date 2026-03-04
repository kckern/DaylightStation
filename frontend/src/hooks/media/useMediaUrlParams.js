import { useMemo, useRef } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaUrlParams' });
  return _logger;
}

const MEDIA_ACTIONS = ['play', 'queue'];

/**
 * Parse URL params for MediaApp autoplay commands.
 * Supports: ?play=contentId, ?queue=contentId, and alias shorthand (?hymn=198).
 * Config modifiers: ?volume=, ?shuffle=, ?shader=
 * Device targeting: ?device=deviceId (cast to remote device instead of local play)
 */
export function useMediaUrlParams() {
  const logged = useRef(false);

  const command = useMemo(
    () => parseAutoplayParams(window.location.search, MEDIA_ACTIONS),
    []
  );

  const device = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('device') || null;
  }, []);

  if (!command && !device) return null;

  const result = { ...command, device };
  if (!logged.current) {
    logged.current = true;
    logger().info('media-url-params.parsed', {
      action: command?.play ? 'play' : command?.queue ? 'queue' : 'device-only',
      contentId: (command?.play || command?.queue)?.contentId,
      device,
    });
  }
  return result;
}

export default useMediaUrlParams;
