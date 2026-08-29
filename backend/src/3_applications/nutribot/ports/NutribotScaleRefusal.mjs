/**
 * Typed application outcome for a scale request that was validly refused.
 *
 * This is deliberately an outcome rather than an exception: the legacy edge
 * adapter maps it to the established public response envelope without routing
 * it through the generic router error telemetry path.
 */
export class NutribotScaleRefusal {
  constructor({ code, message }) {
    this.code = code;
    this.message = message;
  }
}
