import React from 'react';
import PropTypes from 'prop-types';
import './SidebarCore.scss';

/**
 * SidebarCore - Level 2 Module: Sidebar shell/container
 * 
 * Provides the structural wrapper for sidebar panels. Handles:
 * - Panel ordering and layout
 * - Scrollable content area
 * - Menu overlay mounting point
 * 
 * This is a composition component - it renders its children in a
 * standardized sidebar layout without knowing what panels are inside.
 * 
 * @example
 * <SidebarCore mode="player" onOpenMenu={handleOpenMenu}>
 *   <TreasureBoxPanel onClick={handleToggleChart} />
 *   <GovernancePanel />
 *   <UsersPanel onRequestGuestAssignment={handleGuest} />
 *   <MusicPanel />
 *   <VoiceMemoPanel />
 * </SidebarCore>
 */
const SidebarCore = ({
  children,
  mode = 'player',
  className = '',
  menuOverlay = null,
  ...props
}) => {
  const rootClasses = [
    'sidebar-core',
    `sidebar-core--mode-${mode}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClasses} {...props}>
      <div className="sidebar-core__content">
        {children}
      </div>
      
      {/* Menu overlay portal point */}
      {menuOverlay && (
        <div className="sidebar-core__menu-overlay">
          {menuOverlay}
        </div>
      )}
    </div>
  );
};

SidebarCore.propTypes = {
  /** Panel components to render inside the sidebar */
  children: PropTypes.node,
  /** Sidebar mode affects styling */
  mode: PropTypes.oneOf(['player', 'plugin', 'session', 'standalone']),
  /** Additional CSS classes */
  className: PropTypes.string,
  /** Menu overlay component (settings menu, guest selector, etc.) */
  menuOverlay: PropTypes.node
};

export default SidebarCore;
