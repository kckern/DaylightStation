// backend/src/3_applications/agents/framework/ToolFactory.mjs

export class ToolFactory {
  static domain;

  constructor(deps) {
    this.deps = deps;
  }

  createTools() {
    throw new Error('Subclass must implement createTools()');
  }
}
