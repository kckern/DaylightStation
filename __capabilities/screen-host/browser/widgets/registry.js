import { WidgetRegistry } from '../../../../frontend/src/lib/widgets/WidgetRegistry.js';
export { WidgetRegistry };

let defaultRegistry = null;

export function getWidgetRegistry() {
  if (!defaultRegistry) {
    defaultRegistry = new WidgetRegistry();
  }
  return defaultRegistry;
}

export function resetWidgetRegistry() {
  defaultRegistry = null;
}
