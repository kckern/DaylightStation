/**
 * Sidebar Modules - Level 2 reusable sidebar panel components
 * 
 * These modules can be composed into any sidebar configuration.
 * Each panel handles its own context consumption and renders its content.
 * 
 * @example
 * import { SidebarCore, TreasureBoxPanel, GovernancePanel, UsersPanel } from './modules/sidebar';
 * 
 * <SidebarCore mode="player">
 *   <TreasureBoxPanel onClick={handleToggleChart} />
 *   <GovernancePanel />
 *   <UsersPanel onRequestGuestAssignment={handleGuest} />
 * </SidebarCore>
 */

// Core wrapper
export { default as SidebarCore } from './SidebarCore.jsx';

// Panel modules
export { default as TreasureBoxPanel } from './TreasureBoxPanel.jsx';
export { default as GovernancePanel } from './GovernancePanel.jsx';
export { default as UsersPanel } from './UsersPanel.jsx';
export { default as MusicPanel } from './MusicPanel.jsx';
export { default as VoiceMemoPanel } from './VoiceMemoPanel.jsx';

// Re-export the underlying implementations for direct access
export { default as FitnessTreasureBox } from '../../FitnessModules/shared/FitnessTreasureBox.jsx';
export { default as FitnessGovernance } from '../../FitnessModules/shared/FitnessGovernance.jsx';
export { default as FitnessUsersList } from '../../FitnessModules/shared/FitnessUsers.jsx';
export { default as FitnessMusicPlayer } from '../../FitnessModules/shared/FitnessMusicPlayer.jsx';
export { default as FitnessVoiceMemo } from '../../FitnessModules/shared/FitnessVoiceMemo.jsx';
export { default as FitnessSidebarMenu } from '../../FitnessModules/shared/FitnessSidebarMenu.jsx';
