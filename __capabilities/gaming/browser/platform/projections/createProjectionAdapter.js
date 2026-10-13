export function createProjectionAdapter({ id, project }) {
  if (!id || typeof project !== 'function') throw new Error('Projection adapter requires id and project');
  return Object.freeze({ id, project(authoritativeState, context = {}) { return project(structuredClone(authoritativeState), context); } });
}

export function projectForOptionalRenderer(adapter, authoritativeState, { fallback = null, diagnostics = () => {}, context = {} } = {}) {
  try { return adapter.project(authoritativeState, context); }
  catch (error) { diagnostics({ kind: 'projection-failure', adapter: adapter.id, error }); return structuredClone(fallback); }
}
