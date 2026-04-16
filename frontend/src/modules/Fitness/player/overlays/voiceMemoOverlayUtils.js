// frontend/src/modules/Fitness/player/overlays/voiceMemoOverlayUtils.js

/**
 * Determines what action a dismiss gesture should take based on the
 * source of the dismiss and the current recorder state.
 *
 * @param {'backdrop' | 'escape' | 'close_button' | 'discard_button'} dismissSource
 * @param {'recording' | 'processing' | 'idle' | 'ready' | 'errored'} recorderState
 * @returns {'stop_and_transcribe' | 'cancel_and_close'}
 */
export function resolveDismissAction(dismissSource, recorderState) {
  // Backdrop and Escape should preserve the recording when one is active.
  // Close button and Discard button are explicit cancel actions.
  if (
    (dismissSource === 'backdrop' || dismissSource === 'escape') &&
    recorderState === 'recording'
  ) {
    return 'stop_and_transcribe';
  }
  return 'cancel_and_close';
}
