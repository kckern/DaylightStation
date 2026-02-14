/**
 * Overlay Modules - Level 2 reusable overlay components
 * 
 * These modules wrap the existing overlay implementations with:
 * - Consistent prop interfaces
 * - Visibility control
 * - Integration with the overlay management system
 * 
 * @example
 * import { OverlayPortal, VoiceMemoOverlayModule, GovernanceOverlayModule } from './modules/overlays';
 * 
 * // In a view component:
 * <OverlayPortal visible={showVoiceMemo} priority="critical">
 *   <VoiceMemoOverlayModule overlayState={voiceMemoState} ... />
 * </OverlayPortal>
 */

// Core portal component
export { default as OverlayPortal } from './OverlayPortal.jsx';

// Overlay modules
export { default as VoiceMemoOverlayModule } from './VoiceMemoOverlayModule.jsx';
export { default as GovernanceOverlayModule } from './GovernanceOverlayModule.jsx';
export { default as ChallengeOverlayModule, useChallengeOverlays } from './ChallengeOverlayModule.jsx';
export { default as FullscreenVitalsOverlayModule } from './FullscreenVitalsOverlayModule.jsx';

// Re-export the underlying implementations for direct access
export { default as VoiceMemoOverlay } from '../../FitnessPlayerOverlay/VoiceMemoOverlay.jsx';
export { default as GovernanceStateOverlay } from '../../FitnessPlayerOverlay/GovernanceStateOverlay.jsx';
export { ChallengeOverlay, useChallengeMachine, CHALLENGE_PHASES } from '../../FitnessPlayerOverlay/ChallengeOverlay.jsx';
export { default as FullscreenVitalsOverlay } from '../../FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx';

// Re-export the governance display hook (replaces useGovernanceOverlay)
export { useGovernanceDisplay } from '../../hooks/useGovernanceDisplay.js';
