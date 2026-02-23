import { Item } from './Item.mjs';

/**
 * A content item that can be launched on a target device.
 * The launchIntent is opaque to the domain — adapters interpret it.
 */
export class LaunchableItem extends Item {
  /**
   * @param {Object} props - Item props plus launch-specific fields
   * @param {Object} props.launchIntent - { target: string, params: Object }
   * @param {string|null} [props.deviceConstraint] - e.g. 'android'
   * @param {string|null} [props.console] - e.g. 'n64', 'snes'
   */
  constructor(props) {
    super(props);
    this.launchIntent = props.launchIntent ?? null;
    this.deviceConstraint = props.deviceConstraint ?? null;
    this.console = props.console ?? null;
  }

  /** @returns {boolean} */
  isLaunchable() {
    return true;
  }
}

export default LaunchableItem;
