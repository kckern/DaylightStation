import { IArcadeGameOverlay } from "../../application/ports/IArcadeGameOverlay.mjs";

/**
 * One overlay port over a house whose screens run different kiosk apps: each
 * device goes to the overlay driver built for its provider. A device with no
 * driver did not declare an overlay, and nothing is put on it.
 */
export class DeviceRoutedArcadeGameOverlay extends IArcadeGameOverlay {
  #overlays;

  /** @param {{overlayByDevice: Map<string, IArcadeGameOverlay>}} config */
  constructor({ overlayByDevice } = {}) {
    super();
    if (!overlayByDevice) throw new Error('DeviceRoutedArcadeGameOverlay requires overlayByDevice');
    this.#overlays = overlayByDevice;
  }

  async arm(deviceId, url) {
    const overlay = this.#overlays.get(deviceId);
    return overlay ? overlay.arm(deviceId, url) : false;
  }

  async disarm(deviceId) {
    const overlay = this.#overlays.get(deviceId);
    return overlay ? overlay.disarm(deviceId) : false;
  }
}

export default DeviceRoutedArcadeGameOverlay;
