// frontend/src/screen-framework/panels/PanelRenderer.jsx
import React from 'react';
import { getWidgetRegistry } from '../widgets/registry.js';
import { useSlotState } from '../slots/ScreenSlotProvider.jsx';
import './PanelRenderer.css';

function themeVars(theme) {
  if (!theme) return {};
  return Object.fromEntries(
    Object.entries(theme).map(([k, v]) => [`--screen-${k}`, v])
  );
}

function flexItemStyle(node) {
  return {
    flexGrow: node.grow ?? 1,
    flexShrink: node.shrink ?? 1,
    flexBasis: node.basis || 'auto',
    overflow: node.overflow || undefined,
  };
}

function SlotNode({ node }) {
  const slotState = useSlotState(node.slot);
  const theme = themeVars(node.theme);

  if (slotState) {
    const registry = getWidgetRegistry();
    const Component = registry.get(slotState.widget);
    if (!Component) return null;

    return (
      <div
        className="screen-panel screen-panel--widget screen-panel--slot-active"
        style={{ ...flexItemStyle(node), ...theme }}
      >
        <Component {...slotState.props} />
      </div>
    );
  }

  // Render default subtree
  if (node.default) {
    return <PanelRenderer node={{ ...node.default, grow: node.grow, shrink: node.shrink, basis: node.basis }} />;
  }

  return null;
}

export function PanelRenderer({ node }) {
  if (!node) return null;

  const theme = themeVars(node.theme);

  // Slot node — dynamic replacement
  if (node.slot) {
    return <SlotNode node={node} />;
  }

  // Leaf node — render widget
  if (node.widget) {
    const registry = getWidgetRegistry();
    const Component = registry.get(node.widget);
    if (!Component) return null;

    return (
      <div
        className="screen-panel screen-panel--widget"
        style={{ ...flexItemStyle(node), ...theme }}
      >
        <Component />
      </div>
    );
  }

  // Branch node — flex container
  if (node.children) {
    return (
      <div
        className="screen-panel"
        style={{
          flexDirection: node.direction || 'row',
          justifyContent: node.justify || undefined,
          alignItems: node.align || 'stretch',
          gap: node.gap || undefined,
          ...flexItemStyle(node),
          ...theme,
        }}
      >
        {node.children.map((child, i) => (
          <PanelRenderer key={child.widget || child.slot || `panel-${i}`} node={child} />
        ))}
      </div>
    );
  }

  return null;
}
