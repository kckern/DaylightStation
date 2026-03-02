// frontend/src/screen-framework/providers/ScreenProvider.jsx
import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';

const ScreenContext = createContext(null);

/**
 * Recursively walk the config tree and assign path-based IDs to nodes
 * that lack an explicit `id`.
 *
 * Naming convention:
 *   Depth 1: area-0, area-1, ...
 *   Depth 2: area-0.panel-0, area-1.panel-1, ...
 *   Depth 3+: area-0.panel-0.widget-0, ...
 */
function annotateIds(node, parentPath = '', depth = 0) {
  if (!node || typeof node !== 'object') return node;

  const annotated = { ...node };

  // Recurse into children
  if (Array.isArray(annotated.children)) {
    annotated.children = annotated.children.map((child, i) => {
      const childCopy = { ...child };

      // Determine child's depth label
      const childDepth = depth + 1;
      const childLabel = childDepth === 1 ? 'area' : childDepth === 2 ? 'panel' : 'widget';

      // Assign id if missing
      if (!childCopy.id) {
        const segment = `${childLabel}-${i}`;
        childCopy.id = parentPath ? `${parentPath}.${segment}` : segment;
      }

      // Recurse
      return annotateIds(childCopy, childCopy.id, childDepth);
    });
  }

  return annotated;
}

/**
 * Find a node by ID in the config tree (depth-first search).
 * Returns the node object or undefined if not found.
 */
function findNodeById(tree, nodeId) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.id === nodeId) return tree;

  if (Array.isArray(tree.children)) {
    for (const child of tree.children) {
      const found = findNodeById(child, nodeId);
      if (found) return found;
    }
  }

  return undefined;
}

/**
 * Produce the effective layout tree by overlaying the top of each
 * replacement stack onto the annotated original config.
 *
 * For each node that has a replacement stack, the top entry's subtree
 * replaces that node's children/widget properties while preserving
 * the node's layout props (id, grow, shrink, basis, direction, etc.).
 */
function applyReplacements(tree, replacements) {
  if (!tree || typeof tree !== 'object') return tree;

  const node = { ...tree };

  // If this node has a replacement stack, apply the top entry
  if (node.id && replacements[node.id] && replacements[node.id].length > 0) {
    const topReplacement = replacements[node.id][replacements[node.id].length - 1];
    const subtree = topReplacement.subtree;

    // Merge: subtree overrides content (children, widget, props)
    // but original layout props are preserved as defaults.
    // The original `id` is always kept (cannot be overridden).
    const { id, grow, shrink, basis, direction, justify, align, gap, theme, overflow } = node;
    return {
      grow, shrink, basis, direction, justify, align, gap, theme, overflow,
      ...subtree,
      id,
    };
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    node.children = node.children.map(child => applyReplacements(child, replacements));
  }

  return node;
}

/**
 * ScreenProvider — manages the layout config tree with support for
 * dynamic replacement at any level. Replaces ScreenSlotProvider.
 *
 * @param {Object} props.config - The layout tree object
 * @param {React.ReactNode} props.children - Child components
 */
export function ScreenProvider({ config, children }) {
  const [replacements, setReplacements] = useState({});
  const nextIdRef = useRef(1);

  // Annotate the config tree with auto-generated IDs (memoized)
  const annotatedConfig = useMemo(() => annotateIds(config), [config]);

  // Produce the merged config with replacements applied
  const mergedConfig = useMemo(
    () => applyReplacements(annotatedConfig, replacements),
    [annotatedConfig, replacements]
  );

  /**
   * Push a replacement onto the node's stack.
   * Returns a { revert } handle to pop this specific replacement.
   */
  const replace = useCallback((nodeId, subtree) => {
    const replacementId = nextIdRef.current++;
    const entry = { subtree, id: replacementId };

    setReplacements(prev => {
      const stack = prev[nodeId] ? [...prev[nodeId]] : [];
      stack.push(entry);
      return { ...prev, [nodeId]: stack };
    });

    return {
      revert: () => {
        setReplacements(prev => {
          const stack = prev[nodeId];
          if (!stack) return prev;

          const filtered = stack.filter(r => r.id !== replacementId);
          if (filtered.length === 0) {
            const next = { ...prev };
            delete next[nodeId];
            return next;
          }

          return { ...prev, [nodeId]: filtered };
        });
      },
    };
  }, []);

  /**
   * Clear the entire replacement stack for a node,
   * restoring it to the original config.
   */
  const restore = useCallback((nodeId) => {
    setReplacements(prev => {
      if (!prev[nodeId]) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  /**
   * Get the current state of a node by ID.
   * Returns { node, replaced } where `replaced` indicates whether
   * the node is currently showing a replacement.
   */
  const getNode = useCallback((nodeId) => {
    const originalNode = findNodeById(annotatedConfig, nodeId);
    const hasReplacement = replacements[nodeId] && replacements[nodeId].length > 0;

    if (hasReplacement) {
      const effectiveNode = findNodeById(mergedConfig, nodeId);
      return { node: effectiveNode || originalNode, replaced: true };
    }

    return { node: originalNode || null, replaced: false };
  }, [annotatedConfig, mergedConfig, replacements]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    originalConfig: annotatedConfig,
    mergedConfig,
    replacements,
    replace,
    restore,
    getNode,
  }), [annotatedConfig, mergedConfig, replacements, replace, restore, getNode]);

  return (
    <ScreenContext.Provider value={contextValue}>
      {children}
    </ScreenContext.Provider>
  );
}

/**
 * Hook to access the screen layout context.
 * Returns { replace, restore, getNode } plus config references.
 */
export function useScreen() {
  const ctx = useContext(ScreenContext);
  if (!ctx) {
    throw new Error('useScreen() must be used within a <ScreenProvider>');
  }
  return {
    replace: ctx.replace,
    restore: ctx.restore,
    getNode: ctx.getNode,
    mergedConfig: ctx.mergedConfig,
    originalConfig: ctx.originalConfig,
  };
}
