/** Powers and foregrounds an already-mounted screen without reloading its content. */
export class WakeScreenForBroadcast {
  constructor({ devices }) {
    this.devices = devices;
  }

  async execute({ target, prepareOnly = false } = {}) {
    const device = target ? this.devices.get(target) : null;
    if (!device) return { ok: false, error: `unknown target: ${target}` };
    const power = prepareOnly ? { ok: true, skipped: true } : await device.powerOn();
    const foreground = await device.prepareForContent({ skipCameraCheck: true });
    return { ok: power?.ok !== false && foreground?.ok !== false, power, foreground };
  }
}

export default WakeScreenForBroadcast;
