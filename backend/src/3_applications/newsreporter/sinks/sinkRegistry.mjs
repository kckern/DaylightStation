import { PrinterSink } from '#apps/newsreporter/sinks/PrinterSink.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

/**
 * Sink registry (3_applications) — type-keyed factory for ISink implementations.
 *
 * Lives in 3_applications because PrinterSink composes a 1_rendering renderer
 * with a 1_adapters printer transport (a composition only the application layer
 * may perform). `printer` is the only implemented sink today; an unknown type
 * is a config mistake and throws a ValidationError at create() time.
 *
 * @param {{ renderer: object, printerRegistry: { resolve: Function }, logger?: object }} deps
 * @returns {{ create(type: string, cfg: object): import('#apps/newsreporter/ports/ISink.mjs').ISink }}
 */
export function createSinkRegistry({ renderer, printerRegistry, logger } = {}) {
  const factories = {
    printer: () => new PrinterSink({ renderer, printerRegistry, logger }),
  };

  return {
    /**
     * @param {string} type sink type key
     * @param {object} cfg resolved sink config block
     */
    create(type, cfg) {
      const factory = factories[type];
      if (!factory) {
        throw new ValidationError(`unknown sink type: ${type}`, {
          code: 'NEWSREPORTER_UNKNOWN_SINK_TYPE',
          field: 'type',
          type,
        });
      }
      return factory(cfg);
    },
  };
}

export default createSinkRegistry;
