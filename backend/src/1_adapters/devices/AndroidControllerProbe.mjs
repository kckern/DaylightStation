/**
 * Counts the controllers attached to an Android device, and how many are being
 * used.
 *
 * The distinction is the entire point. A pad paired but sitting on the couch is
 * exactly as misleading as an emulator foregrounded with no game loaded — the
 * same trap one level up. Presence is never activity, so this reports them as
 * two separate numbers and never lets one stand in for the other.
 *
 * CENSUS looks for ANALOG STICKS, which is the only thing on this hardware that
 * actually separates a controller from a remote control.
 *
 * The obvious discriminators were tried against the real device and all fail:
 * the Shield's own remote reports input class GAMEPAD (0x61) and source
 * SOURCE_GAMEPAD (0x701), and the living-room air-mouse reports JOYSTICK. Keying
 * on either would count two remote controls as two players sitting down to a
 * four-player game.
 *
 * What a remote does not have is a thumbstick. So a device counts as a
 * controller only if it reports a STICK AXIS — X, Y, Z, RZ or a hat — carrying
 * the joystick source. Both halves are required: the air-mouse's X and Y are
 * SOURCE_MOUSE, and its one joystick-sourced axis is GENERIC_1, so testing the
 * source alone would still have counted it.
 *
 * ACTIVITY comes from sampling the raw input stream for a bounded window. It is
 * the more expensive of the two and blocks for the length of the window, so it
 * is deliberately a separate call rather than something the census drags along.
 */

/** SOURCE_JOYSTICK. A motion axis reporting this comes from a real stick. */
const SOURCE_JOYSTICK = 0x01000010;

const DEVICE_BLOCK = /^\s*Device\s+(-?\d+):\s*(\S.*?)\s*$/;
const AXIS_LINE = /^\s*([A-Z_0-9]+):\s*source=(0x[0-9a-fA-F]+)/;
/** Axes a thumbstick or d-pad hat reports. GENERIC_* deliberately excluded. */
const STICK_AXES = new Set(['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'HAT_X', 'HAT_Y']);
const ADD_DEVICE_LINE = /^add device \d+:\s*(\/dev\/input\/event\d+)/;
const NAME_LINE = /^\s*name:\s*"(.*)"\s*$/;
const EVENT_LINE = /^(\/dev\/input\/event\d+):/;

export class AndroidControllerProbe {
  #adb; #logger;

  constructor({ adbAdapter, logger = console }) {
    if (!adbAdapter?.shell) throw new Error('AndroidControllerProbe requires an adbAdapter');
    this.#adb = adbAdapter;
    this.#logger = logger;
  }

  /**
   * Controllers currently attached.
   * @returns {Promise<{connected: number, names: string[]}|null>} null when the
   *   device could not be asked — which is not the same as zero controllers.
   */
  async census() {
    const output = await this.#run('dumpsys input');
    if (output === null) return null;

    const names = [];
    let current = null;
    let currentHasStick = false;

    const flush = () => {
      if (current && currentHasStick) names.push(current);
      currentHasStick = false;
    };

    for (const raw of output.split('\n')) {
      const block = DEVICE_BLOCK.exec(raw);
      if (block) { flush(); current = block[2]; continue; }
      if (!current) continue;
      const axis = AXIS_LINE.exec(raw);
      if (!axis || !STICK_AXES.has(axis[1])) continue;
      const source = Number.parseInt(axis[2], 16);
      if (Number.isFinite(source) && (source & SOURCE_JOYSTICK) === SOURCE_JOYSTICK) currentHasStick = true;
    }
    flush();
    return { connected: names.length, names };
  }

  /**
   * How many distinct input devices produced events during the window.
   *
   * Blocks for `windowMs`. A quiet window is evidence of nobody pressing
   * anything, NOT evidence that no controller is attached — the two questions
   * are answered by two different calls on purpose.
   */
  async sampleActivity({ windowMs = 3000 } = {}) {
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));
    const output = await this.#run(`timeout ${seconds} getevent`);
    if (output === null) return null;

    const nameByNode = new Map();
    const activeNodes = new Set();
    let lastNode = null;
    for (const raw of output.split('\n')) {
      const add = ADD_DEVICE_LINE.exec(raw);
      if (add) { lastNode = add[1]; continue; }
      const name = NAME_LINE.exec(raw);
      if (name && lastNode) { nameByNode.set(lastNode, name[1]); lastNode = null; continue; }
      const event = EVENT_LINE.exec(raw);
      if (event) activeNodes.add(event[1]);
    }

    return {
      active: activeNodes.size,
      names: [...activeNodes].map((node) => nameByNode.get(node) || node),
      windowMs: seconds * 1000,
    };
  }

  async #run(command) {
    try {
      const result = await this.#adb.shell(command);
      if (!result?.ok) {
        this.#logger.debug?.('play.controllers.shell_failed', { error: result?.error });
        return null;
      }
      return result.output || '';
    } catch (error) {
      this.#logger.debug?.('play.controllers.shell_threw', { error: error.message });
      return null;
    }
  }
}

export default AndroidControllerProbe;
