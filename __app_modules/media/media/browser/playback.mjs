/** Installed Media presentation (provenance handoff + content filter) over the unchanged shared Player implementation. */
import { configurePlaybackPresentation } from '../../../../__capabilities/playback/browser/presentation.mjs';
import {
  useMediaPlaybackPresentation, subscribeMediaLoadingSuppression, getMediaLoadingSuppression,
} from './provenance/playbackPresentation.jsx';
configurePlaybackPresentation({ useVideoPresentation: useMediaPlaybackPresentation,
  subscribeLoadingSuppression: subscribeMediaLoadingSuppression, getLoadingSuppression: getMediaLoadingSuppression });
export { default, Player, PlayerOverlayLoading } from '../../../../__capabilities/playback/browser/public.mjs';
