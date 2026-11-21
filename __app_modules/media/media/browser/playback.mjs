/** Installed Media presentation (content filter + provenance intro) over the unchanged shared Player implementation. */
import { configurePlaybackPresentation } from '../../../../__capabilities/playback/browser/presentation.mjs';
import { useMediaPlaybackPresentation, useMediaVideoIntro } from './provenance/playbackPresentation.jsx';
import { subscribeSkipCard, isSkipCardPaused } from './content-filter/skipCardState.js';
configurePlaybackPresentation({ useVideoPresentation: useMediaPlaybackPresentation, useVideoIntro: useMediaVideoIntro,
  subscribeLoadingSuppression: subscribeSkipCard, getLoadingSuppression: isSkipCardPaused });
export { default, Player, PlayerOverlayLoading } from '../../../../__capabilities/playback/browser/public.mjs';
