/**
 * @interface ISink
 *
 * A sink renders + emits report sections to an output (thermal printer,
 * messaging gateway, ...). Implementations live in 3_applications/sinks
 * (they compose a 1_rendering renderer with a 1_adapters output) or in
 * 1_adapters where no rendering is needed.
 */
export class ISink {
  /**
   * @param {Array} sections validated report sections
   * @param {object} cfg the sink's config block
   * @param {object} ctx run context
   * @returns {Promise<{ status: 'ok'|'error', detail?: object }>}
   */
  async emit(sections, cfg, ctx) {
    throw new Error('ISink.emit must be implemented');
  }
}

export function isSink(obj) {
  return !!obj && typeof obj.emit === 'function';
}
