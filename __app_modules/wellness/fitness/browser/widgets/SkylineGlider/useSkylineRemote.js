import { useEffect, useMemo, useRef } from 'react';
import { holdRemoteButtons } from '../../lib/remoteButtons/remoteButtonHolds.js';
import { isRemoteDirectionSource } from '../../lib/remoteInput/IRemoteDirectionSource.js';
import { normalizeRemoteMapping, remoteAction } from '../../lib/skylineGlider/remoteInput.js';

// Handheld remotes as Skyline Glider input.
//
// `source` is an IRemoteDirectionSource (injected): it reports presses as
// rider directions. The bike's `skyline_glider.remote` block maps a direction
// to an action. Active when the block maps at least one direction and a source
// is given; a bike without the block, or a host without a source, is unchanged.
// Once the source reports a remote, Glider owns every remote press
// (holdRemoteButtons) until it unmounts, so no other remote layer acts on one.
// One `down` is one press; 'repeat' and 'up' are not presses.
//
// onPress({ action, direction, position, sourceId })
export function useSkylineRemote({ source, remoteConfig, onPress, log }) {
  const configSignature = JSON.stringify(remoteConfig ?? null);
  const { mapping, dropped } = useMemo(() => normalizeRemoteMapping(JSON.parse(configSignature)), [configSignature]);
  const mappingSignature = JSON.stringify(mapping);
  const active = isRemoteDirectionSource(source) && Object.keys(mapping).length > 0;
  const latest = useRef(null);
  latest.current = { onPress, log, mapping };

  useEffect(() => {
    if (dropped.length) log?.warn?.('skyline_glider.remote.config_invalid', { dropped });
  }, [configSignature]);

  useEffect(() => {
    if (!active) return undefined;
    let release = null;
    const unsubscribe = source.subscribe((event) => {
      const { mapping: current, onPress: press, log: logger } = latest.current;
      if (event?.type === 'ready') {
        if (event.sources?.length && !release) release = holdRemoteButtons('skyline-glider');
        logger?.info?.('skyline_glider.remote.armed', { remotes: event.sources || [], mapping: current });
        return;
      }
      if (event?.type !== 'press' || event.state !== 'down') return;
      const action = remoteAction(current, event.direction);
      if (!action) {
        logger?.debug?.('skyline_glider.remote.unmapped', { direction: event.direction, sourceId: event.sourceId });
        return;
      }
      press?.({ action, direction: event.direction, position: event.position, sourceId: event.sourceId });
    });
    return () => {
      unsubscribe?.();
      if (release) { release(); latest.current.log?.info?.('skyline_glider.remote.released', {}); }
    };
  }, [active, source, mappingSignature]);

  return { active };
}

export default useSkylineRemote;
