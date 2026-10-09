/**
 * Apply a list of decorators to each tool. Decorators compose left-to-right —
 * the leftmost decorator wraps outermost (its `before` runs first / `after`
 * runs last when execute() is called).
 *
 * Equivalent to: `decorators.reduceRight((wrapped, dec) => dec(wrapped, ctx), tool)`
 * which produces `decorators[0](decorators[1](...(tool)))`.
 *
 * @template T
 * @param {Array<T>} tools
 * @param {Array<import('./ToolDecorator.mjs').ToolDecorator>} decorators
 * @param {object} context — passed to every decorator invocation
 * @returns {Array<T>}
 */
export function applyDecorators(tools, decorators, context) {
  return tools.map((tool) =>
    decorators.reduceRight((wrapped, decorator) => decorator(wrapped, context), tool)
  );
}

export default applyDecorators;
