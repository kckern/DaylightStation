import { useMemo } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaUrlParams' });
  return _logger;
}

const MEDIA_ACTIONS = ['play', 'queue'];

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

  const result = { ...command, device };
  logger().info('media-url-params.parsed', {
    action: command?.play ? 'play' : command?.queue ? 'queue' : 'device-only',
    contentId: (command?.play || command?.queue)?.contentId,
    device,
  });
  return result;
}

export default useMediaUrlParams;
