import { render, RENDERER_VERSION } from './index.mjs';

/** Rendering-layer implementation of the semantic panel renderer capability. */
export function createEinkPanelRenderer({ fontDir } = {}) {
  return Object.freeze({
    render: (screenConfig, options = {}) => render(screenConfig, { ...options, fontDir }),
    version: RENDERER_VERSION,
  });
}

export default createEinkPanelRenderer;
