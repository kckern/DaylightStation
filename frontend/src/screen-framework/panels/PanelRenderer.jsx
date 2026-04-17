// frontend/src/screen-framework/panels/PanelRenderer.jsx
import React from 'react';
import { getWidgetRegistry } from '../widgets/registry.js';
import { useScreen } from '../providers/ScreenProvider.jsx';
import './PanelRenderer.css';

function themeVars(theme) {
  if (!theme) return {};
  return Object.fromEntries(
    Object.entries(theme).map(([k, v]) => [`--screen-${k}`, v])
  );
}

function flexItemStyle(node) {
  return {
    flexGrow: node.grow ?? 0,
    flexShrink: node.shrink ?? 1,
    flexBasis: node.basis || 'auto',
    overflow: node.overflow || undefined,
  };
}

/**
 * Classify a node based on its depth and properties.
 *
 *   depth 1  (direct child of root) → 'area'
 *   depth 2+ with children          → 'panel'
 *   leaf with widget                → 'widget'
 *
 * An explicit `type` field on the node overrides the inference.
 */
function classifyNode(node, depth) {
  if (node.type) return node.type;
  if (node.widget) return 'widget';
  if (depth === 1) return 'area';
  return 'panel';
}

/**
 * Render a leaf widget node.
 *
 * @param {Object} node - Layout node with a `widget` key
 * @param {boolean} fullPanel - Whether this widget is the sole child of its parent
 */
function WidgetNode({ node, fullPanel }) {
  const registry = getWidgetRegistry();
  const Component = registry.get(node.widget);
  if (!Component) {
    console.warn(`[screen-framework] Widget "${node.widget}" not found in registry`);
    return null;
  }

  const theme = themeVars(node.theme);
  const className = fullPanel
    ? 'screen-widget screen-widget--full'
    : 'screen-widget';

  return (
    <div className={className} style={{ ...flexItemStyle(node), ...theme }}>
      <Component {...(node.props || {})} />
    </div>
  );
}

/**
 * Render a container node (area or panel) and recurse into its children.
 */
function ContainerNode({ node, depth, nodeType }) {
  const theme = themeVars(node.theme);
  const className = nodeType === 'area' ? 'screen-area' : 'screen-panel';

  // Only panels get theme-var chrome; areas are pure layout regions.
  const chromeStyle = nodeType === 'panel' ? theme : {};

  const childCount = node.children ? node.children.length : 0;

  // Determine whether a sole widget child should be treated as full-panel.
  // The parent can opt out with `fullPanel: false`.
  const allowFullPanel = node.fullPanel !== false;

  return (
    <div
      className={className}
      style={{
        flexDirection: node.direction || 'row',
        justifyContent: node.justify || undefined,
        alignItems: node.align || 'stretch',
        gap: node.gap || undefined,
        ...flexItemStyle(node),
        ...chromeStyle,
      }}
    >
      {(node.children || []).map((child, i) => (
        <PanelRenderer
          key={child.id || child.widget || `panel-${i}`}
          node={child}
          depth={depth + 1}
          parentChildCount={childCount}
          parentAllowsFullPanel={allowFullPanel}
        />
      ))}
    </div>
  );
}

/**
 * PanelRenderer — renders the layout tree using the area / panel / widget
 * taxonomy.
 *
 * Two calling modes:
 *   1. Context mode (no props) — reads the root from ScreenProvider and
 *      renders the entire layout.
 *   2. Node mode (internal recursion) — renders a specific child node at
 *      the given depth.
 */
function RootPanelRenderer() {
  const { mergedConfig } = useScreen();
  return <PanelRenderer node={mergedConfig} depth={0} />;
}

export function PanelRenderer({
  node,
  depth = 0,
  parentChildCount = 0,
  parentAllowsFullPanel = true,
} = {}) {
  // Context mode: no node prop → delegate to RootPanelRenderer which
  // calls useScreen() unconditionally (satisfying the rules of hooks).
  if (!node) return <RootPanelRenderer />;

  // --- Root node (depth 0) ---
  if (depth === 0) {
    const theme = themeVars(node.theme);
    return (
      <div
        className="screen-root"
        style={{
          flexDirection: node.direction || 'row',
          justifyContent: node.justify || undefined,
          alignItems: node.align || 'stretch',
          gap: node.gap || undefined,
          padding: node.padding || undefined,
          display: 'flex',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          ...theme,
        }}
      >
        {(node.children || []).map((child, i) => (
          <PanelRenderer
            key={child.id || child.widget || `panel-${i}`}
            node={child}
            depth={1}
            parentChildCount={(node.children || []).length}
            parentAllowsFullPanel={node.fullPanel !== false}
          />
        ))}
      </div>
    );
  }

  // --- Classify the node ---
  const nodeType = classifyNode(node, depth);

  // --- Widget leaf ---
  if (nodeType === 'widget') {
    const fullPanel = parentAllowsFullPanel && parentChildCount === 1;
    return <WidgetNode node={node} fullPanel={fullPanel} />;
  }

  // --- Container (area or panel) ---
  return <ContainerNode node={node} depth={depth} nodeType={nodeType} />;
}
