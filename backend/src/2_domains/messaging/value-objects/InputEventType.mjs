// backend/src/1_domains/messaging/value-objects/InputEventType.mjs

/**
 * Input event types for bot message routing.
 *
 * Used by input routers to determine how to handle incoming events.
 */
export const InputEventType = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  IMAGE: 'image',
  CALLBACK: 'callback',
  COMMAND: 'command',
  UPC: 'upc'
});

export default InputEventType;
