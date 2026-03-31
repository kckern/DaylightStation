/**
 * BarcodePayload - Value object for parsed barcode scan data.
 *
 * Supports two barcode types:
 *
 * **Command barcodes** (1-3 segments, checked first):
 *   command                      → bare command (e.g. pause)
 *   command:arg                  → parameterized command (e.g. volume:30)
 *   screen:command               → command on specific screen
 *   screen:command:arg           → parameterized command on specific screen
 *
 * **Content barcodes** (2-4 segments, checked if no command match):
 *   source:id                    → contentId only
 *   action:source:id             → action + contentId
 *   screen:source:id             → screen + contentId
 *   screen:action:source:id      → screen + action + contentId
 *
 * **Content options** (appended to ID with `+`):
 *   plex:595104+shuffle          → contentId plex:595104, options { shuffle: true }
 *   plex:595104+shader=dark      → contentId plex:595104, options { shader: 'dark' }
 *   plex:595104+shuffle+shader=dark → multiple options
 *
 * Delimiters are forgiving — colon, semicolon, or space all work.
 * Dashes are NOT treated as delimiters (they appear in screen names like `living-room`).
 *
 * Commands are detected by checking segments against a knownCommands list.
 * Barcodes with 4+ segments skip command detection entirely.
 *
 * @module domains/barcode/BarcodePayload
 */
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

export class BarcodePayload {
  #type;
  #contentId;
  #action;
  #command;
  #commandArg;
  #options;
  #targetScreen;
  #device;
  #timestamp;

  constructor({ type, contentId, action, command, commandArg, options, targetScreen, device, timestamp }) {
    this.#type = type;
    this.#contentId = contentId;
    this.#action = action;
    this.#command = command;
    this.#commandArg = commandArg;
    this.#options = options;
    this.#targetScreen = targetScreen;
    this.#device = device;
    this.#timestamp = timestamp;
  }

  get type() { return this.#type; }
  get contentId() { return this.#contentId; }
  get action() { return this.#action; }
  get command() { return this.#command; }
  get commandArg() { return this.#commandArg; }
  get options() { return this.#options; }
  get targetScreen() { return this.#targetScreen; }
  get device() { return this.#device; }
  get timestamp() { return this.#timestamp; }

  /**
   * Parse an MQTT barcode message into a BarcodePayload.
   * @param {Object} message - Raw MQTT message { barcode, timestamp, device }
   * @param {string[]} knownActions - Valid action names for content barcodes
   * @param {string[]} knownCommands - Valid command names for control barcodes
   * @returns {BarcodePayload|null} Parsed payload, or null if invalid
   */
  static parse(message, knownActions = [], knownCommands = []) {
    const { barcode, timestamp, device } = message || {};

    if (!barcode || !device) return null;

    // Strip options for command detection (commands don't use options)
    const plusIdx = barcode.indexOf('+');
    const barcodePart = plusIdx !== -1 ? barcode.slice(0, plusIdx) : barcode;

    // Normalize delimiters: semicolons and spaces become colons
    const normalized = barcodePart.replace(/[; ]/g, ':');
    const segments = normalized.split(':');

    const common = { device, timestamp: timestamp || null };

    // ── Command detection (1-3 segments only) ──────────────────────
    if (segments.length <= 3 && knownCommands.length > 0) {
      const cmdResult = BarcodePayload.#parseCommand(segments, knownCommands);
      if (cmdResult) {
        return new BarcodePayload({
          type: 'command',
          contentId: null,
          action: null,
          command: cmdResult.command,
          commandArg: cmdResult.arg,
          options: null,
          targetScreen: cmdResult.screen,
          ...common,
        });
      }
    }

    // ── Content parsing via ContentExpression ──────────────────────
    // Reject barcodes with too many segments (5+) before delegating
    if (segments.length > 4) return null;

    const expr = ContentExpression.fromString(barcode, knownActions);
    if (!expr.contentId) return null;

    const options = Object.keys(expr.options).length > 0 ? expr.options : null;

    return new BarcodePayload({
      type: 'content',
      contentId: expr.contentId,
      action: expr.action,
      command: null,
      commandArg: null,
      options,
      targetScreen: expr.screen,
      ...common,
    });
  }

  /**
   * Try to parse segments as a command barcode.
   * @param {string[]} segments
   * @param {string[]} knownCommands
   * @returns {{command: string, arg: string|null, screen: string|null}|null}
   */
  static #parseCommand(segments, knownCommands) {
    if (segments.length === 1) {
      // "pause"
      if (knownCommands.includes(segments[0])) {
        return { command: segments[0], arg: null, screen: null };
      }
    } else if (segments.length === 2) {
      // "volume:30" (command:arg) or "office:pause" (screen:command)
      if (knownCommands.includes(segments[0])) {
        return { command: segments[0], arg: segments[1], screen: null };
      }
      if (knownCommands.includes(segments[1])) {
        return { command: segments[1], arg: null, screen: segments[0] };
      }
    } else if (segments.length === 3) {
      // "office:volume:30" (screen:command:arg)
      if (knownCommands.includes(segments[1])) {
        return { command: segments[1], arg: segments[2], screen: segments[0] };
      }
    }
    return null;
  }

  toJSON() {
    return {
      type: this.#type,
      contentId: this.#contentId,
      action: this.#action,
      command: this.#command,
      commandArg: this.#commandArg,
      options: this.#options,
      targetScreen: this.#targetScreen,
      device: this.#device,
      timestamp: this.#timestamp,
    };
  }
}
