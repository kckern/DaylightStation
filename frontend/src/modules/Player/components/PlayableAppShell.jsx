// frontend/src/modules/Player/components/PlayableAppShell.jsx

/**
 * Bridges between SinglePlayer's format-based dispatch and AppContainer.
 *
 * When the Play API returns format: 'app', SinglePlayer renders this component.
 * It extracts the appId and param from the contentId and delegates to AppContainer.
 */
import AppContainer from '../../AppContainer/AppContainer.jsx';

export default function PlayableAppShell({ contentId, clear, advance }) {
  // Parse contentId: "app:webcam" → "webcam", "app:family-selector/alan" → "family-selector/alan"
  const localId = contentId?.replace(/^app:/, '') || '';

  // AppContainer parses "family-selector/alan" into appId + param internally
  return <AppContainer open={localId} clear={clear || advance || (() => {})} />;
}
