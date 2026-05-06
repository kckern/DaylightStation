/**
 * ToolBundle — unified contract for a named group of tools.
 *
 * Replaces both `ISkill` (concierge, which had getPromptFragment) and
 * `ToolFactory` (framework, which did not). The prompt-fragment hook is now
 * optional — concierge bundles implement it; health-coach factories leave it
 * as the default null.
 *
 * Naming convention: concrete bundles declare a static `bundleName` string.
 * The base class exposes it via the `name` getter so duck-typed checks still
 * work without the caller needing to know whether they have an instance or
 * a plain object.
 */
export class ToolBundle {
  /** @type {string} — override in subclass */
  static bundleName = '';

  get name() { return this.constructor.bundleName || this.constructor.name; }

  /**
   * Return the ITool array for this bundle.
   * @returns {import('./ports/ITool.mjs').ITool[]}
   */
  createTools() {
    throw new Error(`${this.constructor.name}.createTools() must be implemented`);
  }

  /**
   * Optional prompt section injected before the memory block.
   * Return null (or undefined) to omit.
   * @param {object} context — agent context (may include satellite for concierge)
   * @returns {string|null}
   */
  getPromptFragment(_context) { return null; }

  /**
   * Optional config accessor — return any serialisable config the bundle wants
   * to expose for observability / logging.
   * @returns {object}
   */
  getConfig() { return {}; }
}

/**
 * Duck-typed guard — accepts class instances AND plain objects (for tests and
 * adapters that build plain-object bundles inline).
 */
export function isToolBundle(obj) {
  return !!obj
    && typeof obj.name === 'string'
    && obj.name.length > 0
    && typeof obj.createTools === 'function';
}

export function assertToolBundle(obj) {
  if (!isToolBundle(obj)) {
    throw new Error(
      `ToolBundle: object does not satisfy the ToolBundle contract. `
      + `Expected { name: string, createTools(): ITool[] }. Got: ${JSON.stringify(obj)}`
    );
  }
}

export default ToolBundle;
