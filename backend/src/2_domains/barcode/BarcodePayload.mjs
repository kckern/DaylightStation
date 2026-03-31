/**
 * BarcodePayload - Value object for parsed barcode scan data.
 *
 * Parses barcode strings in these formats (right-to-left, last two segments are always source:id):
 *   source:id                    → contentId only
 *   action:source:id             → action + contentId (action must be in known list)
 *   screen:source:id             → screen + contentId (first segment not a known action)
 *   screen:action:source:id      → screen + action + contentId
 *
 * If a three-segment barcode's first segment is not a known action, it's treated as a screen name.
 *
 * @module domains/barcode/BarcodePayload
 */
export class BarcodePayload {
  #contentId;
  #action;
  #targetScreen;
  #device;
  #timestamp;

  constructor({ contentId, action, targetScreen, device, timestamp }) {
    this.#contentId = contentId;
    this.#action = action;
    this.#targetScreen = targetScreen;
    this.#device = device;
    this.#timestamp = timestamp;
  }

  get contentId() { return this.#contentId; }
  get action() { return this.#action; }
  get targetScreen() { return this.#targetScreen; }
  get device() { return this.#device; }
  get timestamp() { return this.#timestamp; }

  /**
   * Parse an MQTT barcode message into a BarcodePayload.
   * @param {Object} message - Raw MQTT message { barcode, timestamp, device }
   * @param {string[]} knownActions - Valid action names from config
   * @returns {BarcodePayload|null} Parsed payload, or null if invalid
   */
  static parse(message, knownActions = []) {
    const { barcode, timestamp, device } = message || {};

    if (!barcode || !device) return null;

    const segments = barcode.split(':');
    if (segments.length < 2) return null;

    // Last two segments are always source:id
    const contentId = segments.slice(-2).join(':');
    const prefixes = segments.slice(0, -2);

    let action = null;
    let targetScreen = null;

    if (prefixes.length === 1) {
      // One prefix: action or screen depending on whether it's a known action
      if (knownActions.includes(prefixes[0])) {
        action = prefixes[0];
      } else {
        targetScreen = prefixes[0];
      }
    } else if (prefixes.length === 2) {
      // Two prefixes: screen then action
      targetScreen = prefixes[0];
      action = prefixes[1];
    }
    // prefixes.length === 0: just source:id, no overrides

    return new BarcodePayload({
      contentId,
      action,
      targetScreen,
      device,
      timestamp: timestamp || null,
    });
  }

  toJSON() {
    return {
      contentId: this.#contentId,
      action: this.#action,
      targetScreen: this.#targetScreen,
      device: this.#device,
      timestamp: this.#timestamp,
    };
  }
}
