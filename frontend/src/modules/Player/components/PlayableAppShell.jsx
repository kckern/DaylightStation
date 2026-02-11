// frontend/src/modules/Player/components/PlayableAppShell.jsx

/**
 * Bridges between SinglePlayer's format-based dispatch and AppContainer.
 *
 * When the Play API returns format: 'app', SinglePlayer renders this component.
 * It extracts the appId and param from the contentId and delegates to AppContainer.
 */
import { useMemo } from 'react';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { usePlayableLifecycle } from '../../../lib/playable/index.js';

export default function PlayableAppShell({
  contentId,
  clear,
  advance,
  onStartupSignal,
  onPlaybackMetrics,
  onResolvedMeta,
  onRegisterMediaAccess
}) {
  const localId = contentId?.replace(/^app:/, '') || '';

  const meta = useMemo(
    () => localId ? { title: localId, contentId } : null,
    [localId, contentId]
  );

  usePlayableLifecycle({
    onStartupSignal,
    onResolvedMeta,
    onRegisterMediaAccess,
    meta
  });

  return <AppContainer open={localId} clear={clear || advance || (() => {})} />;
}
