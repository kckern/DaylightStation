// frontend/src/modules/Player/components/PlayableAppShell.jsx

/**
 * Bridges between SinglePlayer's format-based dispatch and AppContainer.
 *
 * When the Play API returns format: 'app', SinglePlayer renders this component.
 * It extracts the appId and param from the contentId and delegates to AppContainer.
 * A queue item queued from a list carries that list item's `params`, which
 * SinglePlayer spreads in as a prop; they reach the app as AppContainer's
 * `open.params`, the same contract a menu selection uses.
 */
import { useMemo } from 'react';
import AppContainer, { isAppParams } from '../../../../../frontend/src/modules/AppContainer/AppContainer.jsx';
import { usePlayableLifecycle } from '../hooks/usePlayableLifecycle.js';

// What AppContainer opens for a queued app: the plain id, or `{app, params}`
// when the queue item carries params.
export function appOpenForPlayable(contentId, params) {
  const localId = contentId?.replace(/^app:/, '') || '';
  return isAppParams(params) ? { app: localId, params } : localId;
}

export default function PlayableAppShell({
  contentId,
  params,
  clear,
  advance,
  onPlaybackMetrics: _onPlaybackMetrics,
  onResolvedMeta,
  onRegisterMediaAccess
}) {
  const localId = contentId?.replace(/^app:/, '') || '';

  const meta = useMemo(
    () => localId ? { title: localId, contentId } : null,
    [localId, contentId]
  );

  usePlayableLifecycle({
    onResolvedMeta,
    onRegisterMediaAccess,
    meta
  });

  const open = useMemo(() => appOpenForPlayable(contentId, params), [contentId, params]);

  return <AppContainer open={open} clear={clear || advance || (() => {})} />;
}
