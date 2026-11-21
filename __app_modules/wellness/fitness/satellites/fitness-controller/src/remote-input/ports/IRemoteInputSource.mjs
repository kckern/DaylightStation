/**
 * Port: a source of Bluetooth remote input, owned by RemoteInputService.
 *
 * An adapter reads one kind of input (kernel key events, raw input reports
 * read off the radio, ...) and reports it as normalized events through the
 * `onEvent` callback given to start(). The service never learns how.
 *
 * Normalized events (`source` = the adapter's `id`; addresses upper-case):
 *   { kind: 'control', source, address, name, control, state, raw?, code?, usage? }
 *       control = the key / control name ('AudioVolumeUp', 'ButtonA', ...)
 *       state   = 'down' | 'up' | 'repeat'
 *       raw     = the report bytes it was decoded from (hex), when there were any
 *       code    = a numeric key code, when the source has one; usage = its usage id
 *   { kind: 'device-open', source, address, name, node, nodeKind }
 *   { kind: 'device-gone', source, address, node }
 *   { kind: 'unrecognized', source, address, raw }   input that became no control
 *   { kind: 'report', source, address, name, channel, raw }  a raw report, decoded or not
 *   { kind: 'unavailable', source }                  the source cannot read at all
 *   { kind: 'source-exit', source, code, signal, restartInMs }
 *
 * @interface IRemoteInputSource
 */
export class IRemoteInputSource {
  /** Stable id for logs ('kernel', 'gatt', ...): set by the adapter. */
  id = undefined;

  /** @param {{ onEvent: (event: object) => void }} handlers */
  start(handlers) { // eslint-disable-line no-unused-vars
    throw new Error('IRemoteInputSource.start must be implemented');
  }

  stop() {
    throw new Error('IRemoteInputSource.stop must be implemented');
  }
}

export function isRemoteInputSource(obj) {
  return !!obj && typeof obj.start === 'function' && typeof obj.stop === 'function'
    && typeof obj.id === 'string';
}

export default IRemoteInputSource;
