/**
 * Outbound trigger actuation contract.
 *
 * Trigger workflows speak in household actions. Provider registries, Home
 * Assistant service envelopes, and screen wire payloads belong behind the
 * adapter that implements this port.
 */
export function assertTriggerActuationGateway(gateway) {
  const required = ['clearDevice', 'openDevice', 'activateScene', 'invokeHomeAction', 'sendTransport', 'sendNotification'];
  for (const method of required) {
    if (typeof gateway?.[method] !== 'function') {
      throw new Error(`Trigger actuation gateway requires ${method}()`);
    }
  }
  return gateway;
}
