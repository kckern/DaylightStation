import React from 'react';
import PropTypes from 'prop-types';
import VoiceMemoOverlayImpl from '../../FitnessPlayerOverlay/VoiceMemoOverlay.jsx';

/**
 * VoiceMemoOverlayModule - Wrapper for voice memo recording overlay
 * 
 * This module wraps the VoiceMemoOverlay implementation, providing:
 * - Consistent prop interface
 * - Integration with overlay management system
 * 
 * The overlay renders via its own portal (body-level).
 */
const VoiceMemoOverlayModule = ({
  visible = false,
  overlayState,
  voiceMemos,
  onClose,
  onOpenReview,
  onOpenList,
  onOpenRedo,
  onRemoveMemo,
  onAddMemo,
  onReplaceMemo,
  sessionId,
  playerRef,
  preferredMicrophoneId,
  ...props
}) => {
  // The underlying VoiceMemoOverlay manages its own visibility via overlayState.open
  // We pass through all props directly
  return (
    <VoiceMemoOverlayImpl
      overlayState={overlayState}
      voiceMemos={voiceMemos}
      onClose={onClose}
      onOpenReview={onOpenReview}
      onOpenList={onOpenList}
      onOpenRedo={onOpenRedo}
      onRemoveMemo={onRemoveMemo}
      onAddMemo={onAddMemo}
      onReplaceMemo={onReplaceMemo}
      sessionId={sessionId}
      playerRef={playerRef}
      preferredMicrophoneId={preferredMicrophoneId}
      {...props}
    />
  );
};

VoiceMemoOverlayModule.propTypes = {
  /** External visibility control (overlay also uses overlayState.open internally) */
  visible: PropTypes.bool,
  /** Overlay state from context */
  overlayState: PropTypes.shape({
    open: PropTypes.bool,
    mode: PropTypes.string,
    memoId: PropTypes.string,
    autoAccept: PropTypes.bool,
    startedAt: PropTypes.number,
    onComplete: PropTypes.func
  }),
  /** Array of existing voice memos */
  voiceMemos: PropTypes.array,
  /** Close callback */
  onClose: PropTypes.func,
  /** Open review mode callback */
  onOpenReview: PropTypes.func,
  /** Open list mode callback */
  onOpenList: PropTypes.func,
  /** Open redo/re-record callback */
  onOpenRedo: PropTypes.func,
  /** Remove memo callback */
  onRemoveMemo: PropTypes.func,
  /** Add memo callback */
  onAddMemo: PropTypes.func,
  /** Replace memo callback */
  onReplaceMemo: PropTypes.func,
  /** Session ID for memo association */
  sessionId: PropTypes.string,
  /** Video player ref for pause/resume */
  playerRef: PropTypes.shape({ current: PropTypes.any }),
  /** Preferred microphone device ID */
  preferredMicrophoneId: PropTypes.string
};

export default VoiceMemoOverlayModule;
