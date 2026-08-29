/** Owns the public screen-framework path convention and legacy default. */
export class ScreenAddressResolver {
  constructor({ defaultScreen = 'living-room' } = {}) { this.defaultScreen = defaultScreen; }
  resolve(device) {
    const path = device?.screenPath || `/screen/${this.defaultScreen}`;
    return { path, name: path.replace(/^\/screen\//, '') };
  }
}

export default ScreenAddressResolver;
