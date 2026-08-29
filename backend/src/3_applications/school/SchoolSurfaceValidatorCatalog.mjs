/**
 * Exposes the validators of the live DoNow surface registry in the shape the
 * curriculum validator consumes. The registry is read for every call so late
 * registrations are visible without rebuilding the lifecycle.
 */
export class SchoolSurfaceValidatorCatalog {
  constructor({ surfaces = null } = {}) {
    this.surfaces = surfaces;
  }

  read = () => {
    const validators = new Map();
    if (!this.surfaces) return validators;
    for (const [id, surface] of this.surfaces) {
      validators.set(id, (action) => {
        try {
          return surface.validateAction(action) || [];
        } catch (error) {
          return [error?.message || String(error)];
        }
      });
    }
    return validators;
  };
}
