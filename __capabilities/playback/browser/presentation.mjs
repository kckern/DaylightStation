/** Fixed presentation contract; configured before the first renderer mounts. */
const noSubscription = () => () => {};
const notSuppressed = () => false;
const noVideoPresentation = () => ({ overlay: null, debug: null });
const neutral = Object.freeze({ useVideoPresentation: noVideoPresentation,
  subscribeLoadingSuppression: noSubscription, getLoadingSuppression: notSuppressed });
let installed = null;
let renderingStarted = false;
export function configurePlaybackPresentation(contract) {
  if (!contract || ['useVideoPresentation', 'subscribeLoadingSuppression', 'getLoadingSuppression'].some(key => typeof contract[key] !== 'function'))
    throw new TypeError('Playback presentation requires a hook and loading-store callbacks');
  if (installed) {
    if (Object.keys(neutral).every(key => installed[key] === contract[key])) return;
    throw new Error('Playback presentation is already configured');
  }
  if (renderingStarted) throw new Error('Configure playback presentation before rendering');
  installed = Object.freeze({ ...contract });
}
export function useVideoPresentation(args) {
  renderingStarted = true;
  return (installed || neutral).useVideoPresentation(args);
}
export function getLoadingPresentation() {
  renderingStarted = true;
  return installed || neutral;
}
