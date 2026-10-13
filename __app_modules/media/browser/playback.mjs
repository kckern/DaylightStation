/** Installed Media filtering over the unchanged shared Player implementation. */
import { configurePlaybackPresentation } from '../../../__capabilities/playback/browser/presentation.mjs';
import { useMediaVideoPresentation } from './content-filter/videoPresentation.jsx';
import { subscribeSkipCard, isSkipCardPaused } from './content-filter/skipCardState.js';
configurePlaybackPresentation({ useVideoPresentation: useMediaVideoPresentation,
  subscribeLoadingSuppression: subscribeSkipCard, getLoadingSuppression: isSkipCardPaused });
export { default, Player, PlayerOverlayLoading } from '../../../__capabilities/playback/browser/public.mjs';
