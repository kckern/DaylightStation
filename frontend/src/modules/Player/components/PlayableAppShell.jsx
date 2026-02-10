// frontend/src/modules/Player/components/PlayableAppShell.jsx

/**
 * Bridges between SinglePlayer's format-based dispatch and AppContainer.
 *
 * When the Play API returns format: 'app', SinglePlayer renders this component.
 * It extracts the appId and param from the contentId and delegates to AppContainer.
 */
import { useEffect } from 'react';
import AppContainer from '../../AppContainer/AppContainer.jsx';

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

  // Signal startup when mounted
  useEffect(() => {
    onStartupSignal?.();
  }, []);

  // Report resolved metadata
  useEffect(() => {
    if (localId) {
      onResolvedMeta?.({ title: localId, contentId });
    }
  }, [localId]);

  // Register empty media access (apps have no media element)
  useEffect(() => {
    onRegisterMediaAccess?.({ getMediaEl: () => null, hardReset: null });
  }, []);

  // AppContainer parses "family-selector/alan" into appId + param internally
  return <AppContainer open={localId} clear={clear || advance || (() => {})} />;
}
