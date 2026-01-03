import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const MenuNavigationContext = createContext(null);

/**
 * Navigation state and actions for the menu system.
 * Single source of truth for all menu navigation.
 * 
 * @typedef {Object} StackItem
 * @property {'menu'|'player'|'app'} type - The type of content
 * @property {Object} props - Props for the content component
 * 
 * @typedef {Object} Selection
 * @property {number} index - Selected index
 * @property {string|null} key - Selected item key (for persistence)
 */
export function MenuNavigationProvider({ children, onBackAtRoot }) {
  // Navigation stack: array of { type, props }
  const [stack, setStack] = useState([]);
  
  // Selection state per depth: { [depth]: { index, key } }
  const [selections, setSelections] = useState({ 0: { index: 0, key: null } });
  
  // Current depth (derived from stack length)
  const depth = stack.length;
  
  /**
   * Push new content onto the stack
   * @param {StackItem} content - Content to push
   */
  const push = useCallback((content) => {
    setStack(prev => [...prev, content]);
    // Initialize selection for the new depth
    setSelections(prev => ({
      ...prev,
      [prev.length || Object.keys(prev).length]: { index: 0, key: null }
    }));
  }, []);
  
  /**
   * Pop from the stack (go back)
   * @returns {boolean} Whether pop was successful (false if at root)
   */
  const pop = useCallback(() => {
    setStack(prev => {
      if (prev.length === 0) {
        // At root, call the callback if provided
        onBackAtRoot?.();
        return prev;
      }
      return prev.slice(0, -1);
    });
    // Note: We don't clear selections when popping so state is preserved
    // when navigating back
    return true;
  }, [onBackAtRoot]);
  
  /**
   * Update selection at a specific depth
   * @param {number} targetDepth - The depth to update
   * @param {number} index - The new selected index
   * @param {string|null} [key] - Optional key for the selected item
   */
  const setSelectionAtDepth = useCallback((targetDepth, index, key = null) => {
    setSelections(prev => ({
      ...prev,
      [targetDepth]: { index, key }
    }));
  }, []);
  
  /**
   * Get selection for a specific depth
   * @param {number} targetDepth - The depth to get selection for
   * @returns {Selection} The selection state
   */
  const getSelection = useCallback((targetDepth) => {
    return selections[targetDepth] || { index: 0, key: null };
  }, [selections]);
  
  /**
   * Clear entire stack (reset to root)
   */
  const reset = useCallback(() => {
    setStack([]);
    setSelections({ 0: { index: 0, key: null } });
  }, []);

  /**
   * Replace the current top of stack (useful for refreshing content)
   * @param {StackItem} content - New content for current level
   */
  const replace = useCallback((content) => {
    setStack(prev => {
      if (prev.length === 0) return prev;
      return [...prev.slice(0, -1), content];
    });
  }, []);

  // Back button capture (browser popstate handling)
  useEffect(() => {
    const handlePopState = (event) => {
      event.preventDefault();
      pop();
      // Push a new state to keep the trap active
      window.history.pushState(null, '', window.location.href);
      return false;
    };
    
    // Initial push to enable back button capture
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [pop]);

  const value = {
    // State
    stack,
    depth,
    currentContent: stack[stack.length - 1] || null,
    
    // Selection
    selections,
    getSelection,
    setSelectionAtDepth,
    
    // Navigation
    push,
    pop,
    reset,
    replace,
  };

  return (
    <MenuNavigationContext.Provider value={value}>
      {children}
    </MenuNavigationContext.Provider>
  );
}

/**
 * Hook to access navigation context
 * @returns {Object} Navigation context value
 * @throws {Error} If used outside of MenuNavigationProvider
 */
export function useMenuNavigationContext() {
  const context = useContext(MenuNavigationContext);
  if (!context) {
    throw new Error('useMenuNavigationContext must be used within MenuNavigationProvider');
  }
  return context;
}

/**
 * Hook to check if we're within a MenuNavigationProvider
 * (useful for components that can work with or without the provider)
 * @returns {boolean}
 */
export function useHasMenuNavigationContext() {
  const context = useContext(MenuNavigationContext);
  return context !== null;
}

export default MenuNavigationContext;
